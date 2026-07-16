import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// ============================================================================
// Centralized jurisdiction abstraction for ChessBet's paid platform.
//
// This is the ONLY place in the application that decides which jurisdictions
// are approved for paid functionality. No other function or page may ever
// hard-code a state list — they must call this function (directly, or via
// runContestEligibility, which itself calls this function) and act only on
// its returned `status`.
//
// APPROVED_STATES is the single source of truth for the Tier 1 launch
// footprint. Adding a jurisdiction later requires updating ONLY this array —
// no other business logic changes.
// ============================================================================
const APPROVED_STATES = ['AR', 'CO', 'GA', 'IA', 'KS', 'ND', 'TX', 'VA', 'WI', 'WY'];

// Modular provider abstraction: today this calls MaxMind. A future provider
// (e.g. GeoComply) can replace or supplement this function's internals
// without any caller of getCurrentJurisdiction ever needing to change.
const PROVIDER = 'MaxMind';

const UNKNOWN_MESSAGE =
  'We could not verify your current location. Please disable any VPN, proxy, or location-masking software and try again.';
const BLOCKED_MESSAGE =
  "Paid contests are not currently available in your jurisdiction.\n\nChessBet currently offers paid gameplay only in approved jurisdictions.\n\nYour account remains active for informational purposes, but paid contests are unavailable from your current location.";

async function lookupWithMaxMind(ip) {
  const accountId = Deno.env.get('MAXMIND_ACCOUNT_ID');
  const licenseKey = Deno.env.get('MAXMIND_LICENSE_KEY');
  const authHeader = 'Basic ' + btoa(`${accountId}:${licenseKey}`);

  // The Insights endpoint provides both the subdivision (state) and the
  // anonymizer/VPN/proxy signals needed for jurisdiction enforcement — the
  // plain Country endpoint cannot support either requirement.
  const res = await fetch(`https://geoip.maxmind.com/geoip/v2.1/insights/${ip}`, {
    headers: { Authorization: authHeader },
  });

  if (!res.ok) {
    return { ok: false };
  }

  const data = await res.json();
  const country = data?.country?.iso_code || '';
  const state = data?.subdivisions?.[0]?.iso_code || '';
  const vpnDetected = !!(
    data?.traits?.is_anonymous_vpn ||
    data?.traits?.is_anonymous_proxy ||
    data?.traits?.is_hosting_provider ||
    data?.traits?.is_anonymous ||
    data?.traits?.is_public_proxy ||
    data?.traits?.is_tor_exit_node
  );

  return { ok: true, country, state, vpnDetected };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let triggerEvent = 'manual';
    try {
      const body = await req.json();
      if (body?.triggerEvent) triggerEvent = body.triggerEvent;
    } catch {
      // No body provided — default trigger label is fine.
    }

    // cf-connecting-ip is set by Cloudflare's edge and cannot be spoofed by
    // the client; x-forwarded-for is client-influenceable and must never be
    // trusted as the primary source for a jurisdiction decision.
    const ip = req.headers.get('cf-connecting-ip') || '';
    const deviceIdentifier = req.headers.get('user-agent') || '';

    let status = 'unknown';
    let state = '';
    let country = '';
    let vpnDetected = false;
    let reason = '';

    if (!ip) {
      status = 'unknown';
      reason = UNKNOWN_MESSAGE;
    } else {
      const lookup = await lookupWithMaxMind(ip);
      if (!lookup.ok) {
        status = 'verification_failed';
        reason = 'Unable to verify your location right now. Please try again shortly.';
      } else {
        country = lookup.country;
        state = lookup.state;
        vpnDetected = lookup.vpnDetected;

        if (vpnDetected) {
          // VPN / proxy / hosting provider / anonymous network — always
          // treated as Verification Failed, regardless of detected location.
          status = 'verification_failed';
          reason = UNKNOWN_MESSAGE;
        } else if (!country || !state) {
          status = 'unknown';
          reason = UNKNOWN_MESSAGE;
        } else if (country === 'US' && APPROVED_STATES.includes(state)) {
          status = 'approved';
        } else {
          status = 'blocked';
          reason = BLOCKED_MESSAGE;
        }
      }
    }

    const now = new Date().toISOString();

    await base44.asServiceRole.entities.User.update(user.id, {
      jurisdiction_status: status,
      current_jurisdiction_state: state,
      current_jurisdiction_country: country,
      jurisdiction_last_verified_at: now,
      jurisdiction_verification_provider: PROVIDER,
      jurisdiction_vpn_detected: vpnDetected,
    });

    // Immutable audit log entry — every verification event is recorded, one
    // row per event, never updated or deleted.
    await base44.asServiceRole.entities.JurisdictionVerificationLog.create({
      user_id: user.id,
      ip_address: ip,
      detected_state: state,
      detected_country: country,
      verification_result: status,
      provider: PROVIDER,
      vpn_or_proxy_detected: vpnDetected,
      device_identifier: deviceIdentifier,
      trigger_event: triggerEvent,
      verified_at: now,
    });

    return Response.json({
      status,
      approved: status === 'approved',
      state,
      country,
      vpnDetected,
      reason,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});