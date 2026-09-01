import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { legalNameFromUser, normalizeLegalNameParts } from '../../shared/legalName.ts';

// Authenticated, self-service legal-name capture for funding readiness.
// Identity decisions remain exclusively Socure-controlled. Once an identity
// evaluation is pending or verified, the name cannot be changed here.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const existingLegalName = legalNameFromUser(user);
    if (existingLegalName && ['pending', 'verified'].includes(user.identity_verification_status || '')) {
      return Response.json({ error: 'legal_name_locked' }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const legalName = normalizeLegalNameParts(body?.firstName, body?.lastName);
    if (!legalName) {
      return Response.json({ error: 'valid_legal_name_required' }, { status: 400 });
    }

    await base44.asServiceRole.entities.User.update(user.id, {
      full_name: legalName.fullName,
    });

    return Response.json({ saved: true, full_name: legalName.fullName });
  } catch {
    return Response.json({ error: 'legal_name_update_failed' }, { status: 500 });
  }
});
