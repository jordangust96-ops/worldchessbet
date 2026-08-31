import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { getCountryName, getRegionName } from '../../shared/jurisdictionRegions.js';

// Admin-only aggregate of the jurisdiction interest waitlist. Returns aggregate
// counts by country, by U.S. state, and by delivery status — sorted by demand
// (count desc). Never returns email, user_id, or any user-level PII.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    try {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await base44.asServiceRole.entities.JurisdictionInterest.filter(
      { is_active: true },
      '-consent_at',
      5000,
    );

    const byCountry = new Map();
    const byRegion = new Map();
    const byStatus = new Map();

    for (const r of rows) {
      const cKey = r.selected_country_code || 'UNKNOWN';
      byCountry.set(cKey, (byCountry.get(cKey) || 0) + 1);
      if (r.selected_country_code === 'US' && r.selected_region_code) {
        byRegion.set(r.selected_region_code, (byRegion.get(r.selected_region_code) || 0) + 1);
      }
      const sKey = r.status || 'unknown';
      byStatus.set(sKey, (byStatus.get(sKey) || 0) + 1);
    }

    const by_country = [...byCountry.entries()]
      .map(([code, count]) => ({ country_code: code, country_name: getCountryName(code) || code, count }))
      .sort((a, b) => b.count - a.count || a.country_code.localeCompare(b.country_code));

    const by_region = [...byRegion.entries()]
      .map(([code, count]) => ({ region_code: code, region_name: getRegionName(code) || code, count }))
      .sort((a, b) => b.count - a.count || a.region_code.localeCompare(b.region_code));

    const by_status = [...byStatus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));

    return Response.json({
      total: rows.length,
      by_country,
      by_region,
      by_status,
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Summary failed' }, { status: 500 });
  }
});