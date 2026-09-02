import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { secrets } from 'base44:runtime';
import { buildChessBetEmailHtml } from '../../shared/emailTemplate.ts';
import { isLocationApproved } from '../../shared/jurisdictionRegions.js';

// Processes the jurisdiction interest waitlist: sends a launch notification to
// a pending preference only when its selected location is now explicitly
// allowed by the central server jurisdiction policy (isLocationApproved).
//
// Authorization (enforced BEFORE any service-role read, write, or email):
//   - (a) an authenticated admin user, OR
//   - (b) an exact, timing-safe match of args.run_token against the
//         JURISDICTION_PROCESSOR_RUN_TOKEN server secret (the scheduled
//         workflow passes this token in its args).
//   - Everyone else — including a no-session request with no/invalid token —
//     receives 403 Forbidden and NO service-role work runs. The token is never
//     logged or returned in any response.
//
// State machine (at-most-once send):
//   - selects ONLY rows where status === 'pending' && is_active === true
//   - skips rows whose selected location is not yet approved
//   - claims a row (status -> 'processing', processing_claimed_at, attempts++)
//     BEFORE calling SendEmail; notified/processing rows are never re-selected
//   - on send success: status -> 'notified', notified_at (terminal)
//   - on send failure: status -> 'failed', last_failed_at, last_error (safe)
//
// Bounded batch (MAX_BATCH). Reuses the shared branded email template,
// from_name "ChessBet", and a clear Play ChessBet CTA. Never calls MaxMind.

const MAX_BATCH = 50;

// Fixed-length, constant-time string comparison. Avoids early-exit timing
// leakage on the token compare; length mismatch returns false immediately
// (token lengths are not secret). No external dependency.
function timingSafeStringEqual(a, b) {
  const enc = new TextEncoder();
  const ea = enc.encode(String(a));
  const eb = enc.encode(String(b));
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // --- Authorization (precedes any service-role read/write/email) ---
    let body = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    } catch {
      body = {};
    }
    const presentedToken = typeof body.run_token === 'string' ? body.run_token : '';
    const expectedToken = secrets.get('JURISDICTION_PROCESSOR_RUN_TOKEN') || '';

    let authorized = false;
    if (expectedToken && presentedToken) {
      authorized = timingSafeStringEqual(presentedToken, expectedToken);
    }
    if (!authorized) {
      try {
        const user = await base44.auth.me();
        if (user && user.role === 'admin') authorized = true;
      } catch {
        // No resolvable session, or a non-admin session: stays unauthorized.
      }
    }
    if (!authorized) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // --- Authorized. Service-role work happens only below this point. ---
    const svc = base44.asServiceRole.entities;

    const appUrl = (Deno.env.get('APP_URL') || '').replace(/\/$/, '');
    if (!appUrl) {
      return Response.json({ error: 'APP_URL not configured' }, { status: 500 });
    }

    const policies = await svc.PrivacyPolicyConfig.filter({ policy_type: 'privacy_policy', is_active: true });
    const supportEmail = policies[0]?.support_email || '';

    // At-most-once selection: only pending active rows. Processing/notified/
    // failed rows are never selected here, so a sent row can never be re-sent.
    const pending = await svc.JurisdictionInterest.filter(
      { launch_epoch: 2, is_active: true, status: 'pending' },
      '-consent_at',
      MAX_BATCH,
    );

    const stats = { considered: pending.length, eligible: 0, sent: 0, failed: 0, skipped_not_allowed: 0 };

    for (const row of pending) {
      // Send only when the selected location is now EXPLICITLY allowed by the
      // shared server approval test (centralized with geogating).
      if (!isLocationApproved(row.selected_country_code, row.selected_region_code)) {
        stats.skipped_not_allowed++;
        continue;
      }
      stats.eligible++;

      const now = new Date().toISOString();
      const nextAttempts = (row.attempts || 0) + 1;

      // Claim the record before sending. Because we only ever select
      // status === 'pending', a row claimed here (-> 'processing') can never be
      // re-selected by a concurrent run, and a notified row stays out of the
      // pending set permanently.
      await svc.JurisdictionInterest.update(row.id, {
        status: 'processing',
        processing_claimed_at: now,
        attempts: nextAttempts,
      });

      try {
        const bodyHtml = `
          <p>Hi there,</p>
          <p>You asked us to notify you when ChessBet becomes available in your selected location. Good news: real-money contests are now available there, and you're clear to play.</p>
          <p>This is your launch notice only — you receive it because your selected location now qualifies.</p>
          <p>See you across the board.</p>
          <p>&mdash; The ChessBet Team</p>
        `;
        const html = buildChessBetEmailHtml({
          appUrl,
          headerTitle: 'ChessBet is now available in your location',
          headerSubtitle: 'Real-money play is live for you',
          bodyHtml,
          ctaText: 'Play ChessBet',
          ctaUrl: appUrl,
          supportEmail,
        });

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: row.email,
          subject: 'ChessBet is now available in your location',
          body: html,
          from_name: 'ChessBet',
        });

        const sentAt = new Date().toISOString();
        await svc.JurisdictionInterest.update(row.id, {
          status: 'notified',
          notified_at: sentAt,
          last_error: '',
        });
        stats.sent++;
      } catch (sendError) {
        // Safe failure state: never expose secrets, IPs, or raw provider payloads.
        const safeMessage = String(sendError?.message || 'send_failed').slice(0, 500);
        const failAt = new Date().toISOString();
        await svc.JurisdictionInterest.update(row.id, {
          status: 'failed',
          last_failed_at: failAt,
          last_error: safeMessage,
        });
        stats.failed++;
      }
    }

    return Response.json({ ok: true, ...stats });
  } catch (error) {
    return Response.json({ error: error?.message || 'Processing failed' }, { status: 500 });
  }
});