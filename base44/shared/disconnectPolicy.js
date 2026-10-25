export const DISCONNECT_POLICY_VERSION = "chesscom-reconnect-v1";
export const HEARTBEAT_STALE_MS = 20_000;
export const HEARTBEAT_INTERVAL_MS = 8_000;
export const DISCONNECT_CONFIRMATION_MS = HEARTBEAT_INTERVAL_MS;

function parseTime(value) {
  if (!value) return NaN;
  const text = String(value);
  const hasTimezone = /Z$|[+-]\\d{2}:?\\d{2}$/.test(text);
  const parsed = Date.parse(hasTimezone ? text : `${text}Z`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function sideToMove(game) {
  return game?.fen?.split(" ")[1] === "b" ? "black" : "white";
}

export function disconnectGraceMs(match, game) {
  const controlDefaults = { blitz: 180_000, rapid: 600_000, classical: 900_000 };
  const baseMs = Number(match?.clock_initial_ms) > 0
    ? Number(match.clock_initial_ms)
    : controlDefaults[match?.time_control] || 300_000;
  const incrementMs = Math.max(0, Number(game?.increment_ms) || 0);
  return Math.max(30_000, Math.min(180_000, Math.floor((baseMs + 40 * incrementMs) * 0.1)));
}

function presenceFields(color) {
  return {
    disconnectedAt: `${color}_disconnected_at`,
    lastSeenAt: `${color}_last_seen_at`,
    reconnectedAt: `${color}_reconnected_at`,
    totalDisconnectedMs: `${color}_total_disconnected_ms`,
    policyVersion: `${color}_disconnect_policy_version`,
  };
}

/**
 * Detects and resolves a disconnected player's failure to reconnect.
 *
 * A missed heartbeat is only evidence that the game client stopped reaching
 * ChessBet; it does not establish intent. We therefore start the published
 * reconnect window when the server first observes staleness, require the
 * disconnected player to be the side to move, and wait one more heartbeat
 * interval after expiry before completing the game. A fresh heartbeat cancels
 * the candidate. The chess clock remains independently authoritative and can
 * still expire first.
 */
export async function checkDisconnectTimeout(base44, candidate, match, now = Date.now()) {
  let game = await base44.asServiceRole.entities.Game.get(candidate.id);
  if (!game || Number(game.launch_epoch) !== 2 || game.status !== "active") return { game, completed: false };

  const color = sideToMove(game);
  const fields = presenceFields(color);
  const lastSeen = parseTime(game[fields.lastSeenAt]);
  const disconnectedAt = parseTime(game[fields.disconnectedAt]);

  if (!Number.isFinite(disconnectedAt)) {
    if (!Number.isFinite(lastSeen) || now - lastSeen <= HEARTBEAT_STALE_MS) return { game, completed: false };
    const detectedAt = new Date(now).toISOString();
    const marked = await base44.asServiceRole.entities.Game.update(game.id, {
      [fields.disconnectedAt]: detectedAt,
      [fields.policyVersion]: DISCONNECT_POLICY_VERSION,
      disconnect_timeout_candidate_at: "",
      disconnect_timeout_candidate_color: "",
    });
    return { game: marked, completed: false, detected: true };
  }

  // Existing disconnect markers predate this policy or used a backdated
  // staleness timestamp. Give every such game a fresh, full reconnect window.
  if (game[fields.policyVersion] !== DISCONNECT_POLICY_VERSION) {
    const resetAt = new Date(now).toISOString();
    const marked = await base44.asServiceRole.entities.Game.update(game.id, {
      [fields.disconnectedAt]: resetAt,
      [fields.policyVersion]: DISCONNECT_POLICY_VERSION,
      disconnect_timeout_candidate_at: "",
      disconnect_timeout_candidate_color: "",
    });
    return { game: marked, completed: false, detected: true };
  }

  // A heartbeat newer than the disconnect marker means the client recovered.
  if (Number.isFinite(lastSeen) && lastSeen >= disconnectedAt) {
    const marked = await base44.asServiceRole.entities.Game.update(game.id, {
      [fields.disconnectedAt]: "",
      [fields.reconnectedAt]: new Date(lastSeen).toISOString(),
      [fields.totalDisconnectedMs]: Math.max(0, Number(game[fields.totalDisconnectedMs]) || 0) + Math.max(0, lastSeen - disconnectedAt),
      disconnect_timeout_candidate_at: "",
      disconnect_timeout_candidate_color: "",
    });
    return { game: marked, completed: false, reconnected: true };
  }

  if (!Number.isFinite(lastSeen) || now - lastSeen <= HEARTBEAT_STALE_MS) return { game, completed: false };

  const turnStartedAt = parseTime(game.turn_started_at);
  if (!Number.isFinite(turnStartedAt)) return { game, completed: false };
  // Chess.com's disconnect timer starts only when the disconnected player is
  // on move. If they disconnected during the opponent's turn, start at this
  // turn's server timestamp.
  const graceStartsAt = Math.max(disconnectedAt, turnStartedAt);
  const graceMs = disconnectGraceMs(match, game);
  if (now - graceStartsAt < graceMs) {
    if (game.disconnect_timeout_candidate_color) {
      const marked = await base44.asServiceRole.entities.Game.update(game.id, {
        disconnect_timeout_candidate_at: "",
        disconnect_timeout_candidate_color: "",
      });
      return { game: marked, completed: false };
    }
    return { game, completed: false };
  }

  const candidateAt = parseTime(game.disconnect_timeout_candidate_at);
  if (game.disconnect_timeout_candidate_color !== color || !Number.isFinite(candidateAt)) {
    const marked = await base44.asServiceRole.entities.Game.update(game.id, {
      disconnect_timeout_candidate_at: new Date(now).toISOString(),
      disconnect_timeout_candidate_color: color,
    });
    return { game: marked, completed: false, confirmationPending: true };
  }
  if (now - candidateAt < DISCONNECT_CONFIRMATION_MS) return { game, completed: false, confirmationPending: true };

  // Re-read immediately before commit. Entity updates are merge-patches rather
  // than compare-and-set, so all identity, turn, heartbeat, and status inputs
  // must still match this pending candidate.
  const latest = await base44.asServiceRole.entities.Game.get(game.id);
  if (
    !latest ||
    latest.status !== "active" ||
    latest.fen !== game.fen ||
    latest.turn_started_at !== game.turn_started_at ||
    latest[fields.disconnectedAt] !== game[fields.disconnectedAt] ||
    latest.disconnect_timeout_candidate_at !== game.disconnect_timeout_candidate_at ||
    latest.disconnect_timeout_candidate_color !== color
  ) return { game: latest || game, completed: false };
  const latestLastSeen = parseTime(latest[fields.lastSeenAt]);
  if (!Number.isFinite(latestLastSeen) || latestLastSeen >= candidateAt || now - latestLastSeen <= HEARTBEAT_STALE_MS) {
    return { game: latest, completed: false };
  }

  const currentTurnStartedAt = parseTime(latest.turn_started_at);
  if (!Number.isFinite(currentTurnStartedAt) || now - Math.max(disconnectedAt, currentTurnStartedAt) < graceMs) {
    return { game: latest, completed: false };
  }

  const activeClockField = color === "white" ? "white_time_ms" : "black_time_ms";
  const elapsedMs = Math.max(0, now - currentTurnStartedAt);
  const remainingMs = Math.max(0, Math.floor((Number(latest[activeClockField]) || 0) - elapsedMs));
  const winnerColor = color === "white" ? "black" : "white";
  const winnerId = winnerColor === "white" ? match.player1_id : match.player2_id;
  const completed = await base44.asServiceRole.entities.Game.update(game.id, {
    status: "completed",
    result: winnerColor === "white" ? "white_win" : "black_win",
    winner_id: winnerId,
    end_reason: "disconnect_timeout",
    completed_at: new Date(now).toISOString(),
    draw_offered_by: "",
    [activeClockField]: remainingMs,
    disconnect_timeout_candidate_at: "",
    disconnect_timeout_candidate_color: "",
  });
  return { game: completed, completed: true };
}
