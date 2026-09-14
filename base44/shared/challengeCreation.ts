import { acquireMatchLock, releaseMatchLock, refreshContestLocks } from './seamlessAtomicStore.ts';
import { fail, findConflictingMatch } from './challengeAccess.ts';
import { isChallenge, challengeExpired } from './challengePolicy.js';

// Both creation endpoints share the same distributed per-player lease.
export async function withChallengeCreationLock(userId: string, work: (checkLease: () => Promise<void>) => Promise<any>) {
  const id = `challenge-creation:${userId}`;
  const owner = crypto.randomUUID();
  if (!await acquireMatchLock(id, owner)) fail('busy', 'A challenge is being created. Please try again.');
  let lost = false;
  const checkLease = async () => {
    if (lost || !await refreshContestLocks(id, [], owner)) {
      lost = true;
      fail('busy', 'Challenge creation was interrupted. Please retry.');
    }
  };
  const timer = setInterval(() => { checkLease().catch(() => { lost = true; }); }, 20000);
  try { return await work(checkLease); }
  finally { clearInterval(timer); await releaseMatchLock(id, owner).catch(() => {}); }
}

export async function requireNoExistingChallenge(base44: any, userId: string) {
  if (await findConflictingMatch(base44, userId))
    fail('active_match', 'Finish your current match before creating another challenge.');
  // Scan past expired invitations; public postings do not use invitation expiry.
  for (let skip = 0; ; skip += 100) {
    const rows = await base44.asServiceRole.entities.Match.filter(
      { launch_epoch: 2, player1_id: userId, status: 'searching' }, '-created_date', 100, skip);
    const open = rows.find((match: any) => !isChallenge(match) || !challengeExpired(match) ||
      ['reserving', 'releasing'].includes(match.challenge_operation_state));
    if (open) fail('open_limit', 'You already have an open challenge. Cancel it before creating another.', 409, { matchId: open.id });
    if (rows.length < 100) break;
  }
}

export async function withChallengePlayersLock(userIds: string[], work: (checkLeases: () => Promise<void>) => Promise<any>) {
  const checks: Array<() => Promise<void>>=[];
  const checkLeases=async()=>{for(const check of checks)await check();};
  const ids=[...new Set(userIds)].sort();
  const next=(i: number): Promise<any> => i===ids.length ? work(checkLeases) : withChallengeCreationLock(ids[i],check=>{checks.push(check);return next(i+1);});
  return next(0);
}
