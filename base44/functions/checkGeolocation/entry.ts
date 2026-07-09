import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Countries where real-money chess wagering is not permitted. Kept simple and
// explicit for this first production implementation of the geolocation check.
const RESTRICTED_COUNTRIES = new Set([
  'KP', // North Korea
  'IR', // Iran
  'SY', // Syria
  'CU', // Cuba
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const accountId = Deno.env.get('MAXMIND_ACCOUNT_ID');
    const licenseKey = Deno.env.get('MAXMIND_LICENSE_KEY');

    // cf-connecting-ip is set by Cloudflare's edge and cannot be spoofed by the
    // client; x-forwarded-for is client-influenceable and must never be trusted
    // as the primary source for a geolocation-based eligibility decision.
    const ip = req.headers.get('cf-connecting-ip') || '';

    if (!ip) {
      return Response.json({ eligible: false, reason: 'Unable to determine your location. Please try again.' });
    }

    const authHeader = 'Basic ' + btoa(`${accountId}:${licenseKey}`);
    const maxmindRes = await fetch(`https://geoip.maxmind.com/geoip/v2.1/country/${ip}`, {
      headers: { Authorization: authHeader },
    });

    if (!maxmindRes.ok) {
      return Response.json({ eligible: false, reason: 'Unable to verify your location right now. Please try again shortly.' });
    }

    const data = await maxmindRes.json();
    const countryCode = data?.country?.iso_code;
    const eligible = !!countryCode && !RESTRICTED_COUNTRIES.has(countryCode);
    const reason = eligible ? undefined : 'Deposits are not available in your current location.';

    await base44.asServiceRole.entities.User.update(user.id, {
      last_geolocation_status: eligible ? 'eligible' : 'ineligible',
      last_geolocation_checked_at: new Date().toISOString(),
    });

    return Response.json({ eligible, reason, country: countryCode });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});