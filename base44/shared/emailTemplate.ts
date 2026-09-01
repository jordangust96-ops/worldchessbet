// Shared ChessBet branded email template, used by any function that sends a
// branded notification email. Supports an optional unsubscribeUrl footer link
// for non-essential (marketing/announcement) emails.
export function buildChessBetEmailHtml({ appUrl, headerTitle, headerSubtitle, bodyHtml, ctaText, ctaUrl, supportEmail, unsubscribeUrl }) {
  const gold = '#C9A84C';
  const fontFamily = "'Inter',Arial,Helvetica,sans-serif";
  const logoBlock = `
    <div style="text-align:center;padding:32px 24px 8px;">
      <table role="presentation" align="center" style="margin:0 auto;border-collapse:collapse;">
        <tr>
          <td style="padding-right:8px;vertical-align:middle;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${gold}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/>
              <path d="M5 21h14"/>
            </svg>
          </td>
          <td style="vertical-align:middle;">
            <span style="font-family:${fontFamily};font-size:24px;font-weight:800;color:${gold};letter-spacing:-0.3px;">ChessBet</span>
          </td>
        </tr>
      </table>
    </div>`;

  const footerLinks = `
    <div style="text-align:center;margin-top:16px;">
      <a href="${appUrl}/privacy-policy" style="color:#8a8a8a;font-size:12px;text-decoration:none;margin:0 8px;">Privacy Policy</a>
      <span style="color:#3a3a3a;">&bull;</span>
      <a href="${appUrl}/terms-of-service" style="color:#8a8a8a;font-size:12px;text-decoration:none;margin:0 8px;">Terms of Service</a>
      ${unsubscribeUrl ? `<span style="color:#3a3a3a;">&bull;</span>
      <a href="${unsubscribeUrl}" style="color:#8a8a8a;font-size:12px;text-decoration:none;margin:0 8px;">Unsubscribe</a>` : ''}
    </div>`;

  return `
  <div style="background:#f2f2f2;padding:32px 12px;font-family:${fontFamily};">
    <div style="max-width:520px;margin:0 auto;background:#0A0A0A;border-radius:16px;overflow:hidden;border:1px solid #1a1a1a;">
      ${logoBlock}
      <div style="text-align:center;padding:0 24px 24px;">
        <h1 style="color:#ffffff;font-size:22px;font-weight:800;margin:0 0 6px;letter-spacing:-0.2px;">${headerTitle}</h1>
        ${headerSubtitle ? `<p style="color:${gold};font-size:14px;font-weight:700;margin:0;">${headerSubtitle}</p>` : ''}
      </div>
      <div style="padding:0 28px 8px;color:#d5d5d5;font-size:14px;line-height:1.7;">
        ${bodyHtml}
      </div>
      ${ctaText && ctaUrl ? `
      <div style="text-align:center;padding:16px 24px 32px;">
        <a href="${ctaUrl}" style="display:inline-block;background:${gold};color:#0A0A0A;font-weight:700;font-size:15px;text-decoration:none;padding:14px 36px;border-radius:12px;">${ctaText}</a>
      </div>` : ''}

      <div style="border-top:1px solid #1a1a1a;padding:20px 24px;text-align:center;">
        <p style="color:#666;font-size:11px;margin:0 0 4px;">&copy; ${new Date().getFullYear()} ChessBet. All rights reserved.</p>
        ${supportEmail ? `<p style="color:#666;font-size:11px;margin:0;">Questions? <a href="mailto:${supportEmail}" style="color:${gold};text-decoration:none;">${supportEmail}</a></p>` : ''}
        ${footerLinks}
      </div>
    </div>
  </div>`;
}