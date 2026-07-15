import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Lets the reporting user add further information to their own case, most
// commonly after an administrator requests it. Creates an append-only
// DisputeCaseNote and, if the case was awaiting information, moves it back
// to under_review so administrators know a response has arrived. Never
// exposes or modifies internal investigation notes.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { caseId, content } = await req.json();
    if (!caseId) return Response.json({ error: 'caseId is required' }, { status: 400 });
    if (!content || !content.trim()) return Response.json({ error: 'content is required' }, { status: 400 });

    const disputeCase = await base44.asServiceRole.entities.DisputeCase.get(caseId);
    if (!disputeCase) return Response.json({ error: 'Case not found' }, { status: 404 });
    if (disputeCase.created_by_id !== user.id) {
      return Response.json({ error: 'You do not have access to this case' }, { status: 403 });
    }

    const note = await base44.asServiceRole.entities.DisputeCaseNote.create({
      case_id: caseId,
      author_role: 'user',
      author_id: user.id,
      author_name: user.full_name || user.email || 'User',
      note_type: 'user_response',
      content: content.trim(),
    });

    let updatedCase = disputeCase;
    if (disputeCase.status === 'awaiting_information') {
      updatedCase = await base44.asServiceRole.entities.DisputeCase.update(caseId, { status: 'under_review' });
    }

    base44.asServiceRole.entities.User.filter({ role: 'admin' })
      .then((admins) =>
        Promise.all(
          admins.map((admin) =>
            base44.asServiceRole.integrations.Core.SendEmail({
              to: admin.email,
              subject: `New Information Submitted — Case #${disputeCase.case_number}`,
              body: `The reporting user has submitted additional information for Case #${disputeCase.case_number}.`,
            }).catch(() => {})
          )
        )
      )
      .catch(() => {});

    return Response.json({ case: updatedCase, note });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});