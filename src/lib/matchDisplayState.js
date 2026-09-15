// Realtime and recovery reads can arrive out of order, including presence-only
// patches from the rematch screen. A completed result must never reopen.
export function mergeMatchDisplay(current, incoming) {
  if (!incoming || current?.id !== incoming.id) return incoming;
  if (['completed', 'cancelled'].includes(current.status) && incoming.status && incoming.status !== current.status) return current;
  const timestamp = value => {
    if (!value) return 0;
    const parsed = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  if (timestamp(incoming.updated_date) && timestamp(incoming.updated_date) < timestamp(current.updated_date)) return current;
  return { ...current, ...incoming };
}

export function isMatchFinalizing(match, game) {
  return Boolean(match && game?.match_id === match.id && game.status === 'completed' &&
    ['in_progress', 'settling'].includes(match.status));
}
