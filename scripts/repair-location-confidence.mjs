import fs from 'node:fs';
function edit(path, oldText, newText) { let s=fs.readFileSync(path,'utf8'); if(!s.includes(oldText))throw Error(path+': target missing'); fs.writeFileSync(path,s.replace(oldText,newText)); }
const gates='base44/shared/jurisdictionGates.js';
edit(gates,'  if (!latest) return false;','  if (!latest || !hasReliableLocationEvidence(latest)) return false;');
fs.appendFileSync(gates,`
 
// Minimum evidence quality for both new decisions and historical approvals.
// IP location remains an estimate; browser evidence can veto, never grant.
export const MIN_STATE_CONFIDENCE = 90;
export const MAX_LOCATION_RADIUS_KM = 100;
export function hasReliableLocationEvidence(row) {
  return Number.isFinite(row?.country_confidence) && row.country_confidence >= 50 &&
    row.country_confidence <= 100 &&
    Number.isFinite(row?.subdivision_confidence) && row.subdivision_confidence >= MIN_STATE_CONFIDENCE &&
    row.subdivision_confidence <= 100 &&
    Number.isFinite(row?.accuracy_radius_km) && row.accuracy_radius_km >= 0 &&
    row.accuracy_radius_km <= MAX_LOCATION_RADIUS_KM &&
    row.geo_mismatch_flag !== true && row.vpn_or_proxy_detected === false &&
    !['is_anonymous_vpn','is_anonymous_proxy','is_public_proxy','is_hosting_provider',
      'is_anonymous','is_tor_exit_node','is_residential_proxy','is_anycast','is_satellite_provider'].some(k=>row[k]===true);
}
`);
const req='base44/shared/requestJurisdiction.ts';
edit(req,'  isReusableVerification,','  isReusableVerification,\n  hasReliableLocationEvidence,');
edit(req,"confidenceFloor('MAXMIND_MIN_SUBDIVISION_CONFIDENCE', 10)","confidenceFloor('MAXMIND_MIN_SUBDIVISION_CONFIDENCE', 90)");
edit(req,'// Server-only policy floors: country 50%, state/subdivision 10%.\n// State confidence temporarily lowered by operator request on 2026-09-10.','// Server-only policy floors: country 50%, state/subdivision 90%.\n// Reject broad estimates and revalidate historical approvals after the false-approval incident.');
edit(req,'    lookup.subdivisionConfidence >= MIN_SUBDIVISION_CONFIDENCE','    lookup.subdivisionConfidence >= MIN_SUBDIVISION_CONFIDENCE &&\n    hasReliableLocationEvidence({ country_confidence:lookup.countryConfidence,\n      subdivision_confidence:lookup.subdivisionConfidence, accuracy_radius_km:lookup.accuracyRadiusKm,\n      vpn_or_proxy_detected:lookup.vpnDetected, is_anycast:lookup.isAnycast, is_satellite_provider:lookup.isSatelliteProvider })');
edit(req,'liveCheckForcedByAdmin || policy.fresh ? null','liveCheckForcedByAdmin || policy.fresh || browserGeoPermission === \'granted\' ? null');
const start='    // Secondary, non-authoritative signal: compare the browser-reported';
let s=fs.readFileSync(req,'utf8'), a=s.indexOf(start), b=s.indexOf('    // Immutable audit log entry',a);
let mismatch=s.slice(a,b);
mismatch=mismatch.replace(/    \/\/ Secondary,[\s\S]*?    let geoMismatchKm;/,'    // Browser coordinates cannot approve a location, but a credible conflict vetoes approval.\n    let geoMismatchKm;');
mismatch=mismatch.replace("typeof browserLatitude === 'number' &&","Number.isFinite(browserLatitude) && Math.abs(browserLatitude) <= 90 &&")
.replace("typeof browserLongitude === 'number' &&","Number.isFinite(browserLongitude) && Math.abs(browserLongitude) <= 180 &&");
mismatch=mismatch.replace('geoMismatchFlag = geoMismatchKm > GEO_MISMATCH_THRESHOLD_KM;', "geoMismatchFlag = browserGeoPermission === 'granted' &&\n        Number.isFinite(browserAccuracyMeters) && browserAccuracyMeters >= 0 && browserAccuracyMeters <= 10000 &&\n        geoMismatchKm > GEO_MISMATCH_THRESHOLD_KM + browserAccuracyMeters / 1000;");
mismatch+="    if (geoMismatchFlag && status === 'approved') {\n      status = 'verification_failed';\n      reason = 'Your location signals disagree. Please try another connection or contact support.';\n    }\n\n";
s=s.slice(0,a)+s.slice(b);
s=s.replace('    // Disabled/missing MaxMind configuration is a failure, never an approval.',mismatch+'    // Disabled/missing MaxMind configuration is a failure, never an approval.');
s=s.replace('// review only. It never blocks or restricts the user — browser geolocation\n// is always a secondary, non-authoritative signal.','// review. A credible conflict rejects approval; browser coordinates can\n// never grant approval or override the provider allowlist.');
fs.writeFileSync(req,s);
const wallet='base44/shared/walletOnboardingLocation.ts';
edit(wallet,'// Wallet onboarding approval is permanent; gameplay uses separate fresh evidence.',"import { hasReliableLocationEvidence } from './jurisdictionGates.js';\nimport { isLocationApproved } from './jurisdictionRegions.js';\n// Wallet onboarding evidence must continue to satisfy the current quality policy.");
edit(wallet,"  return !!row && row.user_id === userId", "  return !!row && hasReliableLocationEvidence(row) && isLocationApproved(row.detected_country,row.detected_state) && row.user_id === userId");
edit(wallet,"  return publicStatus(last && last.user_id === userId && last.verification_result !== 'approved' ? last : null);","  if (last?.user_id === userId && last.verification_result === 'approved')\n    return {allowed:false,status:'verification_failed',verifiedAt:null,promptEligible:false,\n      reason:'Your previous location estimate was too uncertain. Please verify your location again using another connection.'};\n  return publicStatus(last && last.user_id === userId ? last : null);");
console.log('Location quality and saved-evidence gates updated.');
