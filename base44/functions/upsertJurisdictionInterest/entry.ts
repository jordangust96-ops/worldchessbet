import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  normalizeCountryCode,
  normalizeRegionCode,
  isValidIsoCountry,
  isValidUsRegion,
  getCountryName,
  getRegionName,
} from '../../shared/jurisdictionRegions.js';

// Authenticated upsert for the jurisdiction interest waitlist.
//
// Identity is derived strictly from the authenticated session via auth.me():
// the opt-in recipient is ALWAYS the calling user. Any user_id/email supplied
// in the request body is ignored — an arbitrary recipient identity can never
// be inserted. Validates allowlisted ISO country codes and U.S. regions,
// normalizes values to canonical uppercase, and idempotently keeps a single
// active preference per user (update-or-create; stale duplicates deactivated).
//
// Does NOT call MaxMind, getCurrentJurisdiction, or any email sender. No
// confirmation email is sent on opt-in; launch notifications are delivered
// only by processJurisdictionApprovalNotifications, and only when the user's
// selected location is explicitly approved by server policy.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!user.email) return Response.json({ error: 'Authenticated account has no email' }, { status: 400 });

    // Body is advisory only. selectedCountryCode / selectedRegionCode are the
    // only fields read; recipient identity (user_id/email) is never taken from it.
    let body = {};
    try {
      body = await req.json();
    } catch {
      // Missing/invalid body — handled as empty below (will fail validation).
    }

    const rawCountry = normalizeCountryCode(body.selectedCountryCode);
    const rawRegion = normalizeRegionCode(body.selectedRegionCode);

    if (!rawCountry || !isValidIsoCountry(rawCountry)) {
      return Response.json({ error: 'Please select a valid country.' }, { status: 400 });
    }
    if (rawCountry === 'US') {
      if (!rawRegion || !isValidUsRegion(rawRegion)) {
        return Response.json({ error: 'Please select a valid U.S. state.' }, { status: 400 });
      }
    }

    const countryName = getCountryName(rawCountry) || rawCountry;
    const regionCode = rawCountry === 'US' ? rawRegion : '';
    const regionName = rawCountry === 'US' ? (getRegionName(rawRegion) || rawRegion) : '';
    const now = new Date().toISOString();

    const svc = base44.asServiceRole.entities;

    // Enforce one active preference per authenticated user: update the existing
    // active row in place, and deactivate any stray duplicates. Create only if
    // none exists. Resetting delivery state to pending on every save keeps a
    // re-opt-in (new location) eligible for a future launch notification.
    const fields = {
      launch_epoch: 2,
      user_id: user.id,
      email: user.email,
      selected_country_code: rawCountry,
      selected_country_name: countryName,
      selected_region_code: regionCode,
      selected_region_name: regionName,
      source: 'jurisdiction_guard',
      status: 'pending',
      consent_at: now,
      is_active: true,
      processing_claimed_at: null,
      notified_at: null,
      last_failed_at: null,
      attempts: 0,
      last_error: '',
    };

    const existing = await svc.JurisdictionInterest.filter({ launch_epoch: 2, user_id: user.id, is_active: true }, '-consent_at', 50);

    let record;
    if (existing && existing.length > 0) {
      record = await svc.JurisdictionInterest.update(existing[0].id, fields);
      for (const dup of existing.slice(1)) {
        try { await svc.JurisdictionInterest.update(dup.id, { is_active: false }); } catch { /* best-effort deactivation */ }
      }
    } else {
      // Defensive sweep: deactivate any non-flagged duplicates the user may own.
      const any = await svc.JurisdictionInterest.filter({ launch_epoch: 2, user_id: user.id }, null, 50);
      for (const r of any) {
        if (r.is_active !== false) {
          try { await svc.JurisdictionInterest.update(r.id, { is_active: false }); } catch { /* ignore */ }
        }
      }
      record = await svc.JurisdictionInterest.create(fields);
    }

    // Never return PII beyond what the caller already owns (their own id/email).
    return Response.json({
      ok: true,
      preference: {
        id: record.id,
        selected_country_code: record.selected_country_code,
        selected_country_name: record.selected_country_name,
        selected_region_code: record.selected_region_code,
        selected_region_name: record.selected_region_name,
        status: record.status,
        consent_at: record.consent_at,
      },
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to save preference' }, { status: 500 });
  }
});