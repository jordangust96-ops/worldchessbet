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

// ============================================================================
// REQUIRED BEFORE PUBLIC LAUNCH: set ENABLE_GEOLOCATION_ENFORCEMENT=true.
//
// This flag is the SOLE gate for jurisdiction/geolocation enforcement across
// the entire platform. Every paid flow (login, deposits, match creation,
// match acceptance, lockWager/entry reservation, withdrawals, gameplay,
// etc.) funnels through this function — directly or via
// runContestEligibility, which calls this function — and none of them may
// ever implement their own separate bypass.
//
// While false (pre-launch/dev/staging default): the full check below still
// runs — the MaxMind Insights lookup, every anonymizer/VPN signal, and the
// complete JurisdictionVerificationLog audit record are still captured and
// written exactly as in production — but the decision returned to the
// caller (and persisted onto the User record) is always forced to
// 'approved' so no flow is blocked or restricted based on location. The
// original, pre-bypass result is preserved in the audit log for
// auditability (see pre_bypass_verification_result / pre_bypass_reason /
// enforcement_bypassed / geolocation_enforcement_enabled below).
//
// While true: production behavior is exactly as implemented below —
// whitelist enforcement (APPROVED_STATES) plus all VPN/anonymizer blocking
// — with no other code changes required to flip this on.
// ============================================================================
const ENABLE_GEOLOCATION_ENFORCEMENT = false;

// Modular provider abstraction: today this calls MaxMind. A future provider
// (e.g. GeoComply) can replace or supplement this function's internals
// without any caller of getCurrentJurisdiction ever needing to change.
const PROVIDER = 'MaxMind';

const UNKNOWN_MESSAGE =
  'We could not verify your current location. Please disable any VPN, proxy, or location-masking software and try again.';
const BLOCKED_MESSAGE =
  "Paid contests are not currently available in your jurisdiction.\n\nChessBet currently offers paid gameplay only in approved jurisdictions.\n\nYour account remains active for informational purposes, but paid contests are unavailable from your current location.";

// A mismatch beyond this distance between the MaxMind IP-derived location and
// the browser-reported location is flagged for administrative/forensic
// review only. It never blocks or restricts the user — browser geolocation
// is always a secondary, non-authoritative signal.
const GEO_MISMATCH_THRESHOLD_KM = 100;

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Captures every field the current MaxMind Insights response provides that
// is useful for compliance/forensic purposes. Fields not present in the
// response (e.g. static_ip_score, residential proxy detection — plan/data
// dependent) are simply left undefined rather than guessed at.
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
  const traits = data?.traits || {};
  const vpnDetected = !!(
    traits.is_anonymous_vpn ||
    traits.is_anonymous_proxy ||
    traits.is_hosting_provider ||
    traits.is_anonymous ||
    traits.is_public_proxy ||
    traits.is_tor_exit_node
  );

  return {
    ok: true,
    country: data?.country?.iso_code || '',
    countryConfidence: data?.country?.confidence,
    state: data?.subdivisions?.[0]?.iso_code || '',
    subdivisionConfidence: data?.subdivisions?.[0]?.confidence,
    city: data?.city?.names?.en || '',
    cityConfidence: data?.city?.confidence,
    postalCode: data?.postal?.code || '',
    postalConfidence: data?.postal?.confidence,
    latitude: data?.location?.latitude,
    longitude: data?.location?.longitude,
    accuracyRadiusKm: data?.location?.accuracy_radius,
    timeZone: data?.location?.time_zone || '',
    isp: traits.isp || '',
    organization: traits.organization || '',
    userType: traits.user_type || '',
    connectionType: traits.connection_type || '',
    isAnonymousVpn: !!traits.is_anonymous_vpn,
    isAnonymousProxy: !!traits.is_anonymous_proxy,
    isPublicProxy: !!traits.is_public_proxy,
    isHostingProvider: !!traits.is_hosting_provider,
    isAnonymous: !!traits.is_anonymous,
    isTorExitNode: !!traits.is_tor_exit_node,
    isSatelliteProvider: !!traits.is_satellite_provider,
    isAnycast: !!traits.is_anycast,
    isResidentialProxy: !!traits.is_residential_proxy,
    staticIpScore: traits.static_ip_score,
    vpnDetected,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let triggerEvent = 'manual';
    let relatedEntityType = 'none';
    let relatedEntityId = '';
    let contextAmount;
    let browserLatitude;
    let browserLongitude;
    let browserAccuracyMeters;
    let browserGeoPermission = 'not_requested';
    let deviceFingerprintHash = '';
    try {
      const body = await req.json();
      if (body?.triggerEvent) triggerEvent = body.triggerEvent;
      if (body?.relatedEntityType) relatedEntityType = body.relatedEntityType;
      if (body?.relatedEntityId) relatedEntityId = body.relatedEntityId;
      if (body?.contextAmount !== undefined) contextAmount = Number(body.contextAmount);
      if (body?.browserGeoPermission) browserGeoPermission = body.browserGeoPermission;
      if (typeof body?.browserLatitude === 'number') browserLatitude = body.browserLatitude;
      if (typeof body?.browserLongitude === 'number') browserLongitude = body.browserLongitude;
      if (typeof body?.browserAccuracyMeters === 'number') browserAccuracyMeters = body.browserAccuracyMeters;
      if (body?.deviceFingerprintHash) deviceFingerprintHash = body.deviceFingerprintHash;
    } catch {
      // No body provided — defaults above are fine.
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
    let lookupDetails = {};

    if (!ip) {
      status = 'unknown';
      reason = UNKNOWN_MESSAGE;
    } else {
      const lookup = await lookupWithMaxMind(ip);
      if (!lookup.ok) {
        status = 'verification_failed';
        reason = 'Unable to verify your location right now. Please try again shortly.';
      } else {
        lookupDetails = lookup;
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

    // Preserve the fully-computed, pre-bypass result for audit purposes
    // before the centralized bypass (if any) below overrides it.
    const wouldBeStatus = status;
    const wouldBeReason = reason;
    let enforcementBypassed = false;

    // REQUIRED BEFORE PUBLIC LAUNCH: set ENABLE_GEOLOCATION_ENFORCEMENT=true.
    // The one and only bypass branch in the app — overrides a non-approved
    // result so it never blocks/restricts a flow while enforcement is
    // disabled. The original result computed above is untouched in
    // wouldBeStatus/wouldBeReason and is written to the audit log below.
    if (!ENABLE_GEOLOCATION_ENFORCEMENT && status !== 'approved') {
      enforcementBypassed = true;
      status = 'approved';
      reason = '';
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

    // Secondary, non-authoritative signal: compare the browser-reported
    // coordinates (if the client requested and was granted permission) with
    // MaxMind's IP-derived coordinates. Purely informational/forensic — it
    // never affects `status` above and never blocks or restricts the user.
    let geoMismatchKm;
    let geoMismatchFlag = false;
    if (
      typeof browserLatitude === 'number' &&
      typeof browserLongitude === 'number' &&
      typeof lookupDetails.latitude === 'number' &&
      typeof lookupDetails.longitude === 'number'
    ) {
      geoMismatchKm = haversineDistanceKm(
        lookupDetails.latitude,
        lookupDetails.longitude,
        browserLatitude,
        browserLongitude
      );
      geoMismatchFlag = geoMismatchKm > GEO_MISMATCH_THRESHOLD_KM;
    }

    // Immutable audit log entry — every verification event is recorded, one
    // row per event, never updated or deleted. Captures every available
    // MaxMind Insights field (including anonymizer signals when false),
    // forensic context about what triggered the check, and the secondary
    // browser geolocation / device fingerprint signals when supplied.
    await base44.asServiceRole.entities.JurisdictionVerificationLog.create({
      user_id: user.id,
      ip_address: ip,
      detected_state: state,
      detected_country: country,
      detected_city: lookupDetails.city || '',
      detected_postal_code: lookupDetails.postalCode || '',
      country_confidence: lookupDetails.countryConfidence,
      subdivision_confidence: lookupDetails.subdivisionConfidence,
      city_confidence: lookupDetails.cityConfidence,
      postal_confidence: lookupDetails.postalConfidence,
      latitude: lookupDetails.latitude,
      longitude: lookupDetails.longitude,
      accuracy_radius_km: lookupDetails.accuracyRadiusKm,
      time_zone: lookupDetails.timeZone || '',
      isp: lookupDetails.isp || '',
      organization: lookupDetails.organization || '',
      user_type: lookupDetails.userType || '',
      connection_type: lookupDetails.connectionType || '',
      is_anonymous_vpn: !!lookupDetails.isAnonymousVpn,
      is_anonymous_proxy: !!lookupDetails.isAnonymousProxy,
      is_public_proxy: !!lookupDetails.isPublicProxy,
      is_hosting_provider: !!lookupDetails.isHostingProvider,
      is_anonymous: !!lookupDetails.isAnonymous,
      is_tor_exit_node: !!lookupDetails.isTorExitNode,
      is_satellite_provider: !!lookupDetails.isSatelliteProvider,
      is_anycast: !!lookupDetails.isAnycast,
      is_residential_proxy: !!lookupDetails.isResidentialProxy,
      static_ip_score: lookupDetails.staticIpScore,
      verification_result: status,
      provider: PROVIDER,
      geolocation_enforcement_enabled: ENABLE_GEOLOCATION_ENFORCEMENT,
      enforcement_bypassed: enforcementBypassed,
      pre_bypass_verification_result: wouldBeStatus,
      pre_bypass_reason: wouldBeReason,
      vpn_or_proxy_detected: vpnDetected,
      device_identifier: deviceIdentifier,
      trigger_event: triggerEvent,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
      context_amount: contextAmount,
      browser_geo_permission: browserGeoPermission,
      browser_latitude: browserLatitude,
      browser_longitude: browserLongitude,
      browser_accuracy_meters: browserAccuracyMeters,
      geo_mismatch_km: geoMismatchKm,
      geo_mismatch_flag: geoMismatchFlag,
      device_fingerprint_hash: deviceFingerprintHash,
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