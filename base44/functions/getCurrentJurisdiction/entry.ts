import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  isGeoipEnforcementEnabled,
  canAdminForceLiveCheck,
  isReusableVerification,
} from '../../shared/jurisdictionGates.js';
import { isLocationApproved } from '../../shared/jurisdictionRegions.js';

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
// ============================================================================
// Geolocation enforcement is controlled solely by MAXMIND_GEOIP_ENABLED (see
// base44/shared/jurisdictionGates.js). Product-release state never participates in
// a jurisdiction decision.
//
// MAXMIND_GEOIP_ENABLED must be explicitly true for protected activity. If it
// is false or absent, ChessBet does not call MaxMind and fails closed with a
// clear configuration error. When enabled, fresh checks occur at funding,
// contest creation/joining, and final entry reservation. Successful
// approved/blocked results may be reused briefly only for the same trusted edge
// IP, avoiding duplicate calls without trusting a stale location.
// ============================================================================
// Server-only provider gate. With MAXMIND_GEOIP_ENABLED=true, fresh MaxMind
// lookups run and provider outage / missing credentials fail closed
// (verification_failed), which blocks the paid action. With it false or
// missing, protected activity also fails closed without a provider request.
const MAXMIND_GEOIP_ENABLED = Deno.env.get('MAXMIND_GEOIP_ENABLED') === 'true';
// Separate server-only gate for admin-initiated live lookups. Defaults false
// (env unset), so an administrator cannot trigger a paid MaxMind call unless
// this is also explicitly enabled — required in addition to admin role.
const MAXMIND_ADMIN_FORCE_LIVE_CHECKS = Deno.env.get('MAXMIND_ADMIN_FORCE_LIVE_CHECKS') === 'true';
const ENABLE_GEOLOCATION_ENFORCEMENT = isGeoipEnforcementEnabled(MAXMIND_GEOIP_ENABLED);

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
  if (!accountId || !licenseKey) {
    console.error(JSON.stringify({ event: 'maxmind_lookup_failed', reason: 'configuration_missing' }));
    return { ok: false };
  }

  const authHeader = 'Basic ' + btoa(`${accountId}:${licenseKey}`);
  let res;
  try {
    // Insights supplies subdivision and anonymizer evidence. Keep this endpoint
    // explicit: silently falling back to GeoLite City would remove the
    // anonymizer signals required by the launch policy.
    res = await fetch(`https://geoip.maxmind.com/geoip/v2.1/insights/${ip}`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(7000),
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'maxmind_lookup_failed',
      reason: error?.name === 'TimeoutError' ? 'timeout' : 'network_error',
    }));
    return { ok: false };
  }

  if (!res.ok) {
    console.error(JSON.stringify({ event: 'maxmind_lookup_failed', reason: 'provider_error', status: res.status }));
    return { ok: false };
  }

  const data = await res.json();
  const traits = data?.traits || {};
  const anonymizer = data?.anonymizer || {};
  const signal = (name) => !!(anonymizer[name] ?? traits[name]);
  const isAnonymousVpn = signal('is_anonymous_vpn');
  const isAnonymousProxy = signal('is_anonymous_proxy');
  const isPublicProxy = signal('is_public_proxy');
  const isHostingProvider = signal('is_hosting_provider');
  const isAnonymous = signal('is_anonymous');
  const isTorExitNode = signal('is_tor_exit_node');
  const isResidentialProxy = signal('is_residential_proxy');
  const vpnDetected = !!(
    isAnonymousVpn ||
    isAnonymousProxy ||
    isPublicProxy ||
    isHostingProvider ||
    isAnonymous ||
    isTorExitNode ||
    isResidentialProxy
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
    isAnonymousVpn,
    isAnonymousProxy,
    isPublicProxy,
    isHostingProvider,
    isAnonymous,
    isTorExitNode,
    isSatelliteProvider: !!traits.is_satellite_provider,
    isAnycast: !!traits.is_anycast,
    isResidentialProxy,
    staticIpScore: anonymizer.static_ip_score ?? traits.static_ip_score,
    vpnDetected,
  };
}

async function getReusableVerification(base44, userId, ip) {
  const logs = await base44.asServiceRole.entities.JurisdictionVerificationLog.filter(
    { user_id: userId },
    '-verified_at',
    1
  );
  const latest = logs[0];
  // Delegates the same-IP / TTL / resolvable-decision check to the pure,
  // no-network predicate in base44/shared/jurisdictionGates.js so it stays in
  // sync with the deterministic test and never broadens its reuse window.
  if (!isReusableVerification(latest, ip, Date.now(), undefined, userId)) return null;

  const computedStatus = latest.pre_bypass_verification_result || latest.verification_result;
  return {
    status: computedStatus,
    reason: latest.pre_bypass_reason || '',
    state: latest.detected_state || '',
    country: latest.detected_country || '',
    vpnDetected: !!latest.vpn_or_proxy_detected,
    verifiedAt: latest.verified_at || latest.created_date,
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
    let forceLiveCheck = false;
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
      forceLiveCheck = body?.forceLiveCheck === true;
    } catch {
      // No body provided — defaults above are fine.
    }

    // cf-connecting-ip is set by Cloudflare's edge and cannot be spoofed by
    // the client; x-forwarded-for is client-influenceable and must never be
    // trusted as the primary source for a jurisdiction decision.
    const ip = req.headers.get('cf-connecting-ip') || '';
    const deviceIdentifier = req.headers.get('user-agent') || '';
    const liveCheckForcedByAdmin =
      forceLiveCheck && user.role === 'admin' && canAdminForceLiveCheck(MAXMIND_ADMIN_FORCE_LIVE_CHECKS);

    // Never convert a missing/disabled provider configuration into an approval.
    // This path deliberately performs no paid lookup, then persists the
    // configuration failure below as an auditable, non-reusable decision.
    const providerConfigurationUnavailable =
      !ENABLE_GEOLOCATION_ENFORCEMENT && !liveCheckForcedByAdmin;

    let status = 'unknown';
    let state = '';
    let country = '';
    let vpnDetected = false;
    let reason = '';
    let lookupDetails = {};
    let cachedVerification = null;

    if (providerConfigurationUnavailable) {
      status = 'verification_failed';
      reason = 'Location verification is unavailable because MaxMind is not configured.';
    } else if (!ip) {
      status = 'unknown';
      reason = UNKNOWN_MESSAGE;
    } else {
      cachedVerification = liveCheckForcedByAdmin ? null : await getReusableVerification(base44, user.id, ip);
      if (cachedVerification) {
        status = cachedVerification.status;
        reason = cachedVerification.reason;
        country = cachedVerification.country;
        state = cachedVerification.state;
        vpnDetected = cachedVerification.vpnDetected;
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
          } else if (isLocationApproved(country, state)) {
            status = 'approved';
          } else {
            status = 'blocked';
            reason = BLOCKED_MESSAGE;
          }
        }
      }
    }

    // Disabled/missing MaxMind configuration is a failure, never an approval.
    // Keep this field for historical audit compatibility; new decisions never
    // use an enforcement bypass.
    const wouldBeStatus = status;
    const wouldBeReason = reason;
    const enforcementBypassed = false;

    // A reused result already has an immutable provider audit record. Avoid
    // duplicate User/log writes for the same IP during one short flow.
    if (cachedVerification) {
      return Response.json({
        status,
        approved: status === 'approved',
        state,
        country,
        vpnDetected,
        reason,
        provider: PROVIDER,
        enforcementEnabled: ENABLE_GEOLOCATION_ENFORCEMENT,
        verificationSkipped: false,
        cached: true,
        verifiedAt: cachedVerification.verifiedAt,
      });
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
      provider: PROVIDER,
      enforcementEnabled: ENABLE_GEOLOCATION_ENFORCEMENT,
      verificationSkipped: false,
      cached: false,
      verifiedAt: now,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});