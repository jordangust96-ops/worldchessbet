import { processValidateSession } from './mfaVerify.js';
import { hasVerifiedIdentity } from './identityEligibility.js';
import { paidContestsEnabled } from './seamlessFundingConfig.ts';
import { cents } from './challengePolicy.js';

export class ChallengeError extends Error {
  code: string; status: number; details: any;
  constructor(code: string, message: string, status = 409, details: any = {}) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
export const fail = (code: string, message: string, status = 409, details: any = {}) => {
  throw new ChallengeError(code, message, status, details);
};

export async function requireChallengeSession(req: Request, base44: any, user: any, sessionToken: unknown) {
  if (!user) fail('login_required', 'Sign in to continue.', 401);
  const store = {
    getSessions: (userId: string, tokenHash: string) => base44.asServiceRole.entities.MfaSession.filter(
      { user_id: userId, token_hash: tokenHash, revoked: false }, '-created_date', 1),
    revokeSession: (_userId: string, id: string) => base44.asServiceRole.entities.MfaSession.update(id, { revoked: true }),
    audit: async () => {},
  };
  const result = await processValidateSession({ user, sessionToken, store, userAgent: req.headers.get('user-agent') || '' });
  if (!result.valid) fail('mfa_required', 'Complete sign-in verification to continue.', 401);
  if (['suspended', 'closed'].includes(user.account_state) || user.withdrawal_hold) {
    fail('account_restricted', 'Resolve your account restrictions before creating or accepting a challenge.', 403);
  }
}

export async function requireChallengePolicies(base44: any, userId: string) {
  for (const policyType of ['privacy_policy', 'terms_of_service', 'official_rules']) {
    const configs = await base44.asServiceRole.entities.PrivacyPolicyConfig.filter(
      { is_active: true, policy_type: policyType }, '-version', 1);
    const active = configs[0];
    if (!active) continue; // Same behavior as the existing PolicyAcceptanceGuard.
    const accepted = await base44.asServiceRole.entities.PrivacyPolicyAcceptance.filter(
      { user_id: userId, policy_type: policyType, policy_version: active.version }, '-accepted_at', 1);
    if (!accepted.length) fail('policies_required', 'Review the current ChessBet policies before continuing.', 403);
  }
}

// Query active statuses, not the user's latest five records: older live games
// must not disappear behind newly created, non-binding invitations.
export async function findConflictingMatch(base44: any, userId: string, exceptId = '') {
  for (const field of ['player1_id', 'player2_id', 'challenge_claimant_id']) {
    const active = await base44.asServiceRole.entities.Match.filter({
      launch_epoch: 2, [field]: userId,
      status: { $in: ['preparing', 'both_ready', 'in_progress', 'settling', 'cancelling'] },
    }, '-created_date', 10);
    const conflict = active.find((m: any) => m.id !== exceptId);
    if (conflict) return conflict;
    const pending = await base44.asServiceRole.entities.Match.filter({
      launch_epoch: 2, [field]: userId, challenge_operation_state: { $in: ['reserving', 'releasing'] },
    }, '-created_date', 10);
    const inFlight = pending.find((m: any) => m.id !== exceptId);
    if (inFlight) return inFlight;
  }
  return null;
}

// Read-only, cost-aware gates. Available Balance only; neither pending deposits
// nor Held Balance (including pending winnings) can qualify a player.
export async function inspectChallengePlayer(base44: any, userId: string, match: any) {
  if (!paidContestsEnabled()) return { ready: false, code: 'paid_contests_disabled', reason: 'Money matches are temporarily unavailable.' };
  const user = await base44.asServiceRole.entities.User.get(userId);
  if (!user || ['suspended', 'closed'].includes(user.account_state) || user.withdrawal_hold)
    return { ready: false, code: 'account_restricted', reason: 'Resolve your account restrictions before playing.' };
  if (!await hasVerifiedIdentity(base44, user))
    return { ready: false, code: 'identity_required', reason: 'Complete identity verification in your wallet.' };
  const banks = await base44.asServiceRole.entities.SeamlessBankAccount.filter({ user_id: userId, status: 'verified' }, '-verified_at', 10);
  if (!banks.some((bank: any) => bank.source_id))
    return { ready: false, code: 'bank_required', reason: 'Connect a verified bank account in your wallet.' };
  const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: userId });
  const available = cents(wallets[0]?.available_balance || 0);
  const required = cents(match.wager_amount) + cents(match.platform_service_fee);
  if (!Number.isFinite(available) || available < required)
    return { ready: false, code: 'funds_required', reason: 'Your wallet needs enough available funds for the entry and fee. Pending funds do not count.',
      availableBalance: Math.max(0, available || 0) / 100, totalRequired: required / 100 };
  if (await findConflictingMatch(base44, userId, match.id))
    return { ready: false, code: 'active_match', reason: 'Finish your current match before accepting another.' };
  return { ready: true, availableBalance: available / 100, totalRequired: required / 100 };
}

export async function requireChallengePlayer(base44: any, userId: string, match: any, isCreator = false) {
  const state = await inspectChallengePlayer(base44, userId, match);
  if (!state.ready) {
    if (isCreator) fail('creator_unavailable', 'The creator is not ready to play right now. No funds have been reserved.', 409);
    fail(state.code || 'not_ready', state.reason || 'Complete wallet setup before playing.', 403, state);
  }
  await requireChallengePolicies(base44, userId);
  return state;
}
