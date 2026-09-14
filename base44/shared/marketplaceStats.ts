const PAGE_SIZE = 500;

export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function publicAvailableMatchQuery(userId = '') {
  const query: Record<string, unknown> = {
    launch_epoch: 2,
    status: 'searching',
    $or: [
      { is_private: { $ne: true }, challenge_version: { $ne: 1 } },
      { is_private: true, challenge_version: 1, challenge_publicly_listed: true,
        challenge_expires_at: { $gt: new Date().toISOString() },
        challenge_operation_state: { $nin: ['reserving', 'releasing'] },
        challenge_target_id: { $in: ['', null] } },
    ],
  };
  if (userId) query.player1_id = { $ne: userId };
  return query;
}

export async function countEntities(entity, query) {
  let count = 0;
  let skip = 0;

  while (true) {
    const page = await entity.filter(query, 'created_date', PAGE_SIZE, skip);
    count += page.length;
    if (page.length < PAGE_SIZE) return count;
    skip += page.length;
  }
}
