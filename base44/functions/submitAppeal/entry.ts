import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Lets a user who was the subject of an adverse determination on a resolved
// Dispute Case submit exactly one appeal. Never overwrites the original
// CaseResolution — creates a separate, linked CaseAppeal that enters its own
// review queue.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { caseId, appealReason, supportingInformation } = await req.json();
    if (!caseId) return Response.json({ error: 'caseId is required' }, { status: 400 });
    if (!appealReason || !appealReason.trim()) {
      return Response.json({ error: 'appealReason is required' }, { status: 400 });
    }

    const disputeCase = await base44.asServiceRole.entities.DisputeCase.get(caseId);
    if (!disputeCase) return Response.json({ error: 'Case not found' }, { status: 404 });

    const isSubject = disputeCase.reporting_user_id === user.id || disputeCase.reported_user_id === user.id;
    if (!isSubject) return Response.json({ error: 'You do not have access to this case' }, { status: 403 });

    if (disputeCase.status !== 'resolved') {
      return Response.json({ error: 'Only a resolved case may be appealed' }, { status: 400 });
    }
    if (!disputeCase.violation_found) {
      return Response.json({ error: 'This case did not result in an adverse determination and cannot be appealed' }, { status: 400 });
    }
    if (disputeCase.appeal_id) {
      return Response.json({ error: 'An appeal has already been submitted for this case' }, { status: 400 });
    }

    const resolutions = await base44.asServiceRole.entities.CaseResolution.filter({ case_id: caseId });
    const resolution = resolutions[0] || null;

    const appeal = await base44.asServiceRole.entities.CaseAppeal.create({
      case_id: caseId,
      case_number: disputeCase.case_number,
      appealing_user_id: user.id,
      appeal_reason: appealReason.trim(),
      supporting_information: (supportingInformation || '').trim(),
      status: 'submitted',
      original_admin_id: resolution?.administrator_id || '',
    });

    await base44.asServiceRole.entities.DisputeCase.update(caseId, { appeal_id: appeal.id });

    await base44.asServiceRole.entities.DisputeCaseNote.create({
      case_id: caseId,
      reporting_user_id: disputeCase.reporting_user_id,
      author_role: 'user',
      author_id: user.id,
      author_name: user.full_name || user.email || 'User',
      action_type: 'appeal_submitted',
      content: 'An appeal was submitted for this case.',
      visible_to_user: true,
    });

    base44.asServiceRole.entities.User.filter({ role: 'admin' })
      .then((admins) =>
        Promise.all(
          admins.map((admin) =>
            base44.asServiceRole.integrations.Core.SendEmail({
              to: admin.email,
              subject: `Appeal Submitted — Case #CB-${String(disputeCase.case_number).padStart(6, '0')}`,
              body: `An appeal has been submitted for Case #CB-${String(disputeCase.case_number).padStart(6, '0')}. Review it in the admin dashboard under Appeals.`,
            }).catch(() => {})
          )
        )
      )
      .catch(() => {});

    return Response.json({ appeal });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});