import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Lets the reporting user add follow-up information to their own case,
// typically in response to an admin's "Request Additional Information"
// action. Never modifies contest outcomes, statuses, or balances.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { caseId, content, attachments } = await req.json();
    if (!caseId || !content?.trim()) {
      return Response.json({ error: 'caseId and content are required' }, { status: 400 });
    }

    const disputeCase = await base44.asServiceRole.entities.DisputeCase.get(caseId);
    if (!disputeCase) return Response.json({ error: 'Case not found' }, { status: 404 });
    if (disputeCase.reporting_user_id !== user.id) {
      return Response.json({ error: 'You do not have access to this case' }, { status: 403 });
    }
    if (disputeCase.status === 'resolved' || disputeCase.status === 'closed') {
      return Response.json({ error: 'This case is already closed' }, { status: 400 });
    }

    const previousStatus = disputeCase.status;
    const updatedCase = await base44.asServiceRole.entities.DisputeCase.update(caseId, { status: 'under_review' });

    await base44.asServiceRole.entities.DisputeCaseNote.create({
      case_id: caseId,
      reporting_user_id: disputeCase.reporting_user_id,
      author_id: user.id,
      author_name: user.full_name || user.email,
      author_role: 'user',
      action_type: 'info_submitted',
      content: content.trim(),
      attachments: Array.isArray(attachments) ? attachments : [],
      previous_status: previousStatus,
      new_status: 'under_review',
      visible_to_user: true,
    });

    // Best-effort admin notification â€” never blocks the submission.
    const notifyTargets = disputeCase.assigned_admin_id
      ? [await base44.asServiceRole.entities.User.get(disputeCase.assigned_admin_id).catch(() => null)]
      : await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    await Promise.all(
      notifyTargets
        .filter((a) => a?.email)
        .map((a) =>
          base44.asServiceRole.integrations.Core.SendEmail({
            to: a.email,
            subject: `New Information Submitted â€” Case #${disputeCase.case_number}`,
            body: `The reporting user has submitted additional information for Case #${disputeCase.case_number}.\n\nReview it in the admin Dispute Case Queue.`,
          }).catch(() => {})
        )
    );

    return Response.json({ case: updatedCase });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});