// Transactional MFA email only: no marketing, CTA, or unsubscribe link.
const LOGO_URL = 'https://media.base44.com/images/public/6a4ed72536c51cb3280d2bc6/7eb5eb625_logo-removebg-preview.png';
export function buildMfaEmail(code, expiryMinutes) {
  if (!/^\d{6}$/.test(code) || !Number.isInteger(expiryMinutes) || expiryMinutes < 1) throw new Error('Invalid MFA email input');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#0A0A0A;border:1px solid #272727;border-radius:12px;"><tr><td align="center" style="padding:28px 24px;">
<img src="${LOGO_URL}" alt="ChessBet logo" width="72" height="72" style="display:block;width:72px;height:72px;border:0;margin:0 auto 12px;">
<p style="margin:0 0 24px;color:#C9A84C;font-size:23px;font-weight:bold;">ChessBet</p>
<h1 style="margin:0 0 12px;color:#ffffff;font-size:21px;">Your verification code</h1>
<p style="margin:0 0 20px;color:#dedede;font-size:15px;line-height:1.6;">Enter this code to verify your ChessBet sign-in:</p>
<p style="margin:0 0 20px;padding:16px 8px;background:#1c1a13;border:1px solid #C9A84C;border-radius:8px;color:#C9A84C;font-family:Courier New,monospace;font-size:32px;letter-spacing:6px;font-weight:bold;">${code}</p>
<p style="margin:0 0 12px;color:#dedede;font-size:14px;line-height:1.6;">This code expires in ${expiryMinutes} minutes. Do not share it with anyone.</p>
<p style="margin:0;color:#aaaaaa;font-size:13px;line-height:1.6;">If you didn’t request this code, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
}
