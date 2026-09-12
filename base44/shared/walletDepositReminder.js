export const REMINDER_CAMPAIGN = 'verified-bank-no-deposit-5d-v1';
export const REMINDER_SUBJECT = 'Your ChessBet wallet is ready for your first deposit';
export const CHESSBET_LOGO_URL = 'https://media.base44.com/images/public/6a4ed72536c51cb3280d2bc6/7eb5eb625_logo-removebg-preview.png';
export const WAIT_MS = 5 * 24 * 60 * 60 * 1000;
const time = value => {
  if (!value) return NaN;
  const s = String(value);
  return Date.parse(/T/.test(s) && !/Z$|[+-]\d\d:\d\d$/.test(s) ? s + 'Z' : s);
};
export function reminderEligibility({user,banks,wallets,deposits,deliveries}, now = Date.now()) {
  if (!user?.email || user.marketing_email_opt_out === true || ['closed','suspended','restricted','banned'].includes(user.account_state)) return {eligible:false,reason:'account_or_opt_out'};
  if (deliveries.length) return {eligible:false,reason:'already_attempted'};
  const verified = banks.filter(bank => bank.user_id === user.id && bank.source_id && bank.status === 'verified' && Number.isFinite(time(bank.verified_at)));
  if (!verified.length) return {eligible:false,reason:'no_verified_bank'};
  if (wallets.length !== 1) return {eligible:false,reason:'wallet_unavailable'};
  const wallet = wallets[0];
  if (wallet.user_id !== user.id || !['available_balance','held_balance','total_balance'].every(key => wallet[key] != null && Number.isFinite(Number(wallet[key])))) return {eligible:false,reason:'wallet_unavailable'};
  if (['available_balance','held_balance','total_balance','balance','total_deposited'].some(key => Number(wallet[key] || 0) !== 0)) return {eligible:false,reason:'wallet_already_funded'};
  const real = deposits.filter(tx => tx.type === 'deposit' && tx.user_id === user.id && Number(tx.launch_epoch) === 2 && !/^(early_access|prelaunch_|legacy_)/.test(tx.source_event || ''));
  if (real.some(tx => ['completed','reversed'].includes(tx.status) || ['settled','reversed'].includes(tx.integration_status))) return {eligible:false,reason:'prior_deposit'};
  if (real.some(tx => tx.status !== 'failed' || !['failed','unrouted','internal_complete',''].includes(tx.integration_status || ''))) return {eligible:false,reason:'deposit_in_progress'};
  const dates = real.map(tx => time(tx.processed_at || tx.created_date));
  if (dates.some(date => !Number.isFinite(date))) return {eligible:false,reason:'unknown_deposit_date'};
  const inactiveSince = Math.max(Math.min(...verified.map(bank => time(bank.verified_at))), ...dates);
  const dueAt = inactiveSince + WAIT_MS;
  return {eligible:now >= dueAt,reason:now >= dueAt ? 'due' : 'waiting_five_days',dueAt:new Date(dueAt).toISOString()};
}
export const escapeHtml = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function buildWalletDepositReminder({firstName='there',unsubscribeUrl,supportEmail='hello@worldchessbet.com'}) {
  const name=escapeHtml(firstName), unsubscribe=escapeHtml(unsubscribeUrl), support=escapeHtml(supportEmail);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${REMINDER_SUBJECT}</title></head>
<body style="margin:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Your bank is connected. Fund your wallet and take your seat at the board.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f2f2;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0A0A0A;border:1px solid #252525;border-radius:16px;">
<tr><td align="center" style="padding:30px 24px 18px;">
<img src="${CHESSBET_LOGO_URL}" alt="ChessBet logo" width="76" height="76" style="display:block;width:76px;height:76px;border:0;margin:0 auto 10px;">
<div style="font-size:28px;line-height:34px;font-weight:bold;color:#C9A84C;">ChessBet</div></td></tr>
<tr><td style="padding:0 28px 16px;color:#dedede;font-size:15px;line-height:1.7;">
<h1 style="margin:0 0 22px;color:#ffffff;font-size:25px;line-height:1.3;text-align:center;">Your next move starts here</h1>
<p>Hi ${name},</p>
<p>Your bank account is connected and your ChessBet wallet is ready for a deposit. Take the next step toward your first cash chess game.</p>
<p>Open your wallet, choose your deposit amount, and review the processing fee and total bank debit before confirming.</p>
<p>Once your deposit clears and your funds are available, head to <strong style="color:#ffffff;">Play</strong> to create a challenge or join an available one. You can also invite a friend to a private match.</p>
<p>We&rsquo;ll email you when your deposit is available to play.</p>
<p>See you across the board,<br><strong style="color:#ffffff;">The ChessBet Team</strong></p>
</td></tr>
<tr><td align="center" style="padding:4px 24px 30px;">
<a href="https://worldchessbet.com/wallet" style="display:inline-block;background:#C9A84C;color:#0A0A0A;padding:15px 26px;border-radius:10px;font-size:15px;font-weight:bold;text-decoration:none;">Deposit and Start Playing</a>
</td></tr>
<tr><td align="center" style="border-top:1px solid #292929;padding:22px 24px;color:#a8a8a8;font-size:12px;line-height:1.6;">
<p style="margin:0 0 14px;">You received this one-time reminder because you connected a bank account and have not funded your wallet.</p>
<a href="${unsubscribe}" style="display:inline-block;border:1px solid #9c8645;border-radius:8px;padding:10px 22px;color:#e0c779;font-weight:bold;text-decoration:none;">Unsubscribe</a>
<p style="margin:16px 0 8px;">Need a hand? <a href="mailto:${support}" style="color:#e0c779;">${support}</a></p>
<p style="margin:0;"><a href="https://worldchessbet.com/privacy-policy" style="color:#a8a8a8;">Privacy Policy</a> &middot; <a href="https://worldchessbet.com/terms-of-service" style="color:#a8a8a8;">Terms of Service</a></p>
<p style="margin:12px 0 0;">&copy; ${new Date().getUTCFullYear()} ChessBet. All rights reserved.</p>
</td></tr></table></td></tr></table></body></html>`;
}
