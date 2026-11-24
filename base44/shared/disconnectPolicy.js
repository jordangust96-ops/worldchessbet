export const DISCONNECT_POLICY_VERSION = "chessbet-reconnect-v2";
export const HEARTBEAT_STALE_MS = 20_000;
export const HEARTBEAT_INTERVAL_MS = 8_000;
export const DISCONNECT_CONFIRMATION_MS = HEARTBEAT_INTERVAL_MS;

function parseTime(value) {
  if (!value) return NaN;
  const text = String(value);
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(text);
  return Date.parse(hasTimezone ? text : text + "Z");
}
function sideToMove(game) {
  return game?.fen?.split(" ")[1] === "b" ? "black" : "white";
}
export function disconnectGraceMs(match, game) {
  const defaults = { blitz: 180_000, rapid: 600_000, classical: 900_000 };
  const base = Number(match?.clock_initial_ms) > 0 ? Number(match.clock_initial_ms) : defaults[match?.time_control] || 300_000;
  return Math.max(30_000, Math.min(180_000, Math.floor((base + 40 * Math.max(0, Number(game?.increment_ms) || 0)) * 0.1)));
}

// One server definition supplies both enforcement and the displayed deadline.
// The final heartbeat confirmation interval is INCLUDED in this countdown.
export function getDisconnectState(match, game) {
  const result = { white: null, black: null };
  if (game?.status !== "active") return result;
  for (const color of ["white", "black"]) {
    const detected = parseTime(game[color + "_disconnected_at"]);
    const seen = parseTime(game[color + "_last_seen_at"]);
    if (!Number.isFinite(detected) || game[color + "_disconnect_policy_version"] !== DISCONNECT_POLICY_VERSION ||
        (Number.isFinite(seen) && seen >= detected)) continue;
    const turn = parseTime(game.turn_started_at);
    const onMove = sideToMove(game) === color;
    const deadline = onMove && Number.isFinite(turn)
      ? Math.max(detected, turn) + disconnectGraceMs(match, game) + DISCONNECT_CONFIRMATION_MS : null;
    result[color] = { disconnectedAt: game[color + "_disconnected_at"], deadlineMs: deadline };
  }
  return result;
}

// A missed heartbeat proves loss of contact, never intentional abandonment.
// All callers use guardGameMutations, including its presence check under the
// shared game lease, so a fresh reconnect cannot be overwritten by a timeout.
export async function checkDisconnectTimeout(base44, candidate, match, now = Date.now()) {
  const entity = base44.asServiceRole.entities.Game;
  let game = await entity.get(candidate.id);
  if (!game || Number(game.launch_epoch) !== 2 || game.status !== "active") return { game, completed: false };

  for (const color of ["white", "black"]) {
    const seen = parseTime(game[color + "_last_seen_at"]);
    const detected = parseTime(game[color + "_disconnected_at"]);
    if (Number.isFinite(detected) && Number.isFinite(seen) && seen >= detected) {
      game = await entity.update(game.id, {
        [color + "_disconnected_at"]: "",
        [color + "_disconnect_policy_version"]: "",
        [color + "_reconnected_at"]: new Date(seen).toISOString(),
        [color + "_total_disconnected_ms"]: Math.max(0, Number(game[color + "_total_disconnected_ms"]) || 0) + Math.max(0, seen - detected),
        ...(game.disconnect_timeout_candidate_color === color ? { disconnect_timeout_candidate_at: "", disconnect_timeout_candidate_color: "" } : {}),
      });
    } else if (Number.isFinite(seen) && now - seen > HEARTBEAT_STALE_MS &&
        (!Number.isFinite(detected) || game[color + "_disconnect_policy_version"] !== DISCONNECT_POLICY_VERSION)) {
      // An old-policy marker receives a full new window on migration.
      game = await entity.update(game.id, {
        [color + "_disconnected_at"]: new Date(now).toISOString(),
        [color + "_disconnect_policy_version"]: DISCONNECT_POLICY_VERSION,
        disconnect_timeout_candidate_at: "", disconnect_timeout_candidate_color: "",
      });
    }
  }

  const color = sideToMove(game);
  const state = getDisconnectState(match, game)[color];
  if (!state || state.deadlineMs === null) return { game, completed: false };
  const confirmationAt = state.deadlineMs - DISCONNECT_CONFIRMATION_MS;
  if (game.disconnect_timeout_candidate_color !== color ||
      parseTime(game.disconnect_timeout_candidate_at) !== confirmationAt) {
    game = await entity.update(game.id, {
      disconnect_timeout_candidate_color: color,
      disconnect_timeout_candidate_at: new Date(confirmationAt).toISOString(),
    });
  }
  if (now < state.deadlineMs) return { game, completed: false, confirmationPending: now >= confirmationAt };

  const latest = await entity.get(game.id);
  if (!latest || latest.status !== "active" || latest.fen !== game.fen ||
      latest.turn_started_at !== game.turn_started_at ||
      latest[color + "_disconnected_at"] !== game[color + "_disconnected_at"] ||
      latest.disconnect_timeout_candidate_at !== game.disconnect_timeout_candidate_at ||
      latest.disconnect_timeout_candidate_color !== color) return { game: latest || game, completed: false };
  const seen = parseTime(latest[color + "_last_seen_at"]);
  const winnerColor = color === "white" ? "black" : "white";
  const winnerSeen = parseTime(latest[winnerColor + "_last_seen_at"]);
  // Do not award a disconnect victory while neither client is in contact.
  if (!Number.isFinite(seen) || seen >= parseTime(latest[color + "_disconnected_at"]) ||
      now - seen <= HEARTBEAT_STALE_MS || !Number.isFinite(winnerSeen) ||
      now - winnerSeen > HEARTBEAT_STALE_MS) return { game: latest, completed: false };

  const turn = parseTime(latest.turn_started_at);
  const timeField = color === "white" ? "white_time_ms" : "black_time_ms";
  const remaining = Math.max(0, Math.floor((Number(latest[timeField]) || 0) - Math.max(0, now - turn)));
  // Clock expiry has its own material-aware rule and is handled by checkTimeout.
  if (remaining <= 0) return { game: latest, completed: false, clockExpired: true };
  const completed = await entity.update(game.id, {
    status: "completed", result: winnerColor === "white" ? "white_win" : "black_win",
    winner_id: winnerColor === "white" ? match.player1_id : match.player2_id,
    end_reason: "disconnect_timeout", completed_at: new Date(now).toISOString(),
    draw_offered_by: "", [timeField]: remaining,
    disconnect_timeout_candidate_at: "", disconnect_timeout_candidate_color: "",
  });
  return { game: completed, completed: true };
}

