const PAGE_SIZE = 500;

function parseServerTime(value: unknown, fallbackMs: number) {
  if (typeof value !== 'string' || !value) return fallbackMs;
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  const parsedMs = new Date(hasTimezone ? value : `${value}Z`).getTime();
  return Number.isFinite(parsedMs) ? parsedMs : fallbackMs;
}

export function getAuthoritativeClockState(game: Record<string, unknown>, nowMs = Date.now()) {
  const sideToMove = String(game?.fen || '').split(' ')[1] === 'b' ? 'b' : 'w';
  const timeField = sideToMove === 'w' ? 'white_time_ms' : 'black_time_ms';
  const storedMs = Number(game?.[timeField]);
  const hasClock = Number.isFinite(storedMs) && storedMs >= 0 && Boolean(game?.turn_started_at);
  const turnStartedAtMs = parseServerTime(game?.turn_started_at, nowMs);
  const elapsedMs = Math.max(0, nowMs - turnStartedAtMs);
  const remainingMs = hasClock ? storedMs - elapsedMs : 0;

  return {
    sideToMove,
    timeField,
    remainingMs,
    expired: hasClock && remainingMs <= 0,
    valid: hasClock,
  };
}

export function isGameCurrentlyLive(game: Record<string, unknown>, nowMs = Date.now()) {
  if (game?.status !== 'active') return false;
  const clock = getAuthoritativeClockState(game, nowMs);
  return clock.valid && !clock.expired;
}

export async function countCurrentlyLiveGames(entity: any, nowMs = Date.now()) {
  let count = 0;
  let skip = 0;

  while (true) {
    const page = await entity.filter({ launch_epoch: 2, status: 'active' }, 'created_date', PAGE_SIZE, skip);
    count += page.filter((game: Record<string, unknown>) => isGameCurrentlyLive(game, nowMs)).length;
    if (page.length < PAGE_SIZE) return count;
    skip += page.length;
  }
}

function hasSufficientMatingMaterial(fen: string, color: 'w' | 'b') {
  const boardPart = String(fen || '').split(' ')[0];
  let pawns = 0;
  let knights = 0;
  let bishops = 0;
  let rooks = 0;
  let queens = 0;

  for (const piece of boardPart) {
    if (piece === '/' || (piece >= '1' && piece <= '8')) continue;
    const pieceColor = piece === piece.toUpperCase() ? 'w' : 'b';
    if (pieceColor !== color) continue;
    switch (piece.toLowerCase()) {
      case 'p': pawns += 1; break;
      case 'n': knights += 1; break;
      case 'b': bishops += 1; break;
      case 'r': rooks += 1; break;
      case 'q': queens += 1; break;
    }
  }

  return pawns > 0 || rooks > 0 || queens > 0 || knights + bishops >= 2;
}

export function buildTimeoutCompletion(
  game: Record<string, unknown>,
  match: Record<string, unknown>,
  completedAt = new Date().toISOString(),
) {
  const clock = getAuthoritativeClockState(game);
  if (!clock.valid || !clock.expired) return null;

  const opponentColor = clock.sideToMove === 'w' ? 'b' : 'w';
  const opponentCanMate = hasSufficientMatingMaterial(String(game?.fen || ''), opponentColor);
  const common = {
    status: 'completed',
    completed_at: completedAt,
    [clock.timeField]: 0,
  };

  return opponentCanMate
    ? {
        ...common,
        result: clock.sideToMove === 'w' ? 'black_win' : 'white_win',
        winner_id: clock.sideToMove === 'w' ? match?.player2_id : match?.player1_id,
        end_reason: 'timeout',
      }
    : {
        ...common,
        result: 'draw',
        winner_id: '',
        end_reason: 'timeout_vs_insufficient_material',
      };
}
