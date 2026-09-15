export const MATCH_EMAIL_LOGO = 'https://media.base44.com/images/public/6a4ed72536c51cb3280d2bc6/7eb5eb625_logo-removebg-preview.png';
const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function buildMatchAcceptedEmail({opponentName,wagerAmount,timeControlLabel,appUrl,matchId,deadline,free=false}) {
 const url=escape(`${appUrl}/play?match=${encodeURIComponent(matchId)}`);
 const row=(label,value)=>`<tr><td style="padding:12px 0;border-bottom:1px solid #333;color:#bdbdbd;font-size:14px;">${label}</td><td align="right" style="padding:12px 0;border-bottom:1px solid #333;color:#ffffff;font-size:14px;font-weight:bold;">${value}</td></tr>`;
 return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Your opponent is ready to meet you. Open ChessBet to confirm readiness.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#101010;border:1px solid #292929;border-radius:16px;">
<tr><td align="center" style="padding:28px 24px 12px;"><img src="${MATCH_EMAIL_LOGO}" width="80" height="80" alt="ChessBet logo" style="display:block;width:80px;height:80px;border:0;"><p style="margin:12px 0 0;color:#C9A84C;font-size:24px;font-weight:bold;">ChessBet</p></td></tr>
<tr><td style="padding:12px 28px 28px;"><h1 style="margin:0 0 12px;text-align:center;color:#ffffff;font-size:26px;line-height:1.25;">Your challenge is accepted.</h1>
<p style="margin:0 0 20px;color:#d0d0d0;font-size:15px;line-height:1.6;text-align:center;">${escape(opponentName)} has accepted your challenge. Head to the board and confirm you’re ready.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${row('Opponent',escape(opponentName))}${row(free?'Play mode':'Entry Amount',free?'Free play':'$'+Number(wagerAmount).toFixed(2))}${row('Time Control',escape(timeControlLabel))}</table>
<p style="margin:22px 0 10px;color:#E5CA7A;font-size:14px;line-height:1.6;text-align:center;">Return before ${escape(deadline)}.</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr><td bgcolor="#C9A84C" style="border-radius:10px;text-align:center;"><a href="${url}" style="display:inline-block;padding:15px 38px;color:#101010;font-size:16px;font-weight:bold;text-decoration:none;">Play Now</a></td></tr></table>
<p style="margin:20px 0 0;color:#bdbdbd;font-size:13px;line-height:1.6;text-align:center;">Both players must confirm readiness to start. You can cancel before play starts.</p>
<p style="margin:20px 0 0;color:#999;font-size:12px;line-height:1.6;word-break:break-all;">If the button doesn’t work, open:<br><a href="${url}" style="color:#C9A84C;">${url}</a></p>
</td></tr><tr><td align="center" style="border-top:1px solid #292929;padding:18px 24px;color:#999;font-size:12px;">ChessBet · Your next move awaits.</td></tr>
</table></td></tr></table></body></html>`;
}
