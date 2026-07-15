import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const VALID_STATUSES = ['open', 'under_review', 'awaiting_information', 'resolved', 'closed'];
const VALID_ACTIONS = [
  'add_note',
  'escalate',
  'dismiss',
  'request_information',
  'flag_fair_play_review',
  'flag_aml_review',
  'flag_manual_settlement_review',
  'change_status',
  'assign_to_me',
  'set_resolution',
];

// Administrator-only actions on a Dispute Case. Every action appends an
// immutable DisputeCaseNote (the audit trail) and, where relevant, updates
// administrator-controlled fields on the case itself. None of these actions
// ever touch a Match, Game, ContestRecord, Wallet, or LedgerEntry — contest
// outcomes and balances are never modified from here, by design.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { caseId, action, payload = {} } = await req.json();
    if (!caseId) return Response.json({ error: 'caseId is required' }, { status: 400 });
    if (!VALID_ACTIONS.includes(action)) return Response.json({ error: 'Invalid action' }, { status: 400 });

    const disputeCase = await base44.asServiceRole.entities.DisputeCase.get(caseId);
    if (!disputeCase) return Response.json({ error: 'Case not found' }, { status: 404 });

    const caseUpdates = {};
    let noteType = 'note';
    let noteContent = payload.content || '';
    let previousStatus = '';
    let newStatus = '';

    switch (action) {
      case 'add_note':
        noteType = 'note';
        if (!noteContent.trim()) return Response.json({ error: 'content is required' }, { status: 400 });
        break;
      case 'escalate':
        noteType = 'escalation';
        caseUpdates.escalated = true;
        caseUpdates.priority = 'high';
        noteContent = noteContent || 'Case escalated for priority review.';
        break;
      case 'dismiss':
        noteType = 'dismissal';
        previousStatus = disputeCase.status;
        newStatus = 'closed';
        caseUpdates.status = 'closed';
        caseUpdates.resolution = payload.resolution || 'Dismissed — no action required.';
        caseUpdates.resolution_timestamp = new Date().toISOString();
        noteContent = noteContent || 'Case dismissed.';
        break;
      case 'request_information':
        noteType = 'request_information';
        previousStatus = disputeCase.status;
        newStatus = 'awaiting_information';
        caseUpdates.status = 'awaiting_information';
        noteContent = noteContent || 'Additional information requested from the reporting user.';
        break;
      case 'flag_fair_play_review':
        noteType = 'fair_play_flag';
        caseUpdates.fair_play_review_flag = true;
        noteContent = noteContent || 'Flagged for fair play / anti-cheat review.';
        break;
      case 'flag_aml_review':
        noteType = 'aml_flag';
        caseUpdates.aml_review_flag = true;
        noteContent = noteContent || 'Flagged for AML/compliance review.';
        break;
      case 'flag_manual_settlement_review':
        noteType = 'manual_settlement_flag';
        caseUpdates.manual_settlement_review_flag = true;
        noteContent = noteContent || 'Flagged for manual settlement review.';
        break;
      case 'change_status':
        if (!VALID_STATUSES.includes(payload.status)) {
          return Response.json({ error: 'Invalid status' }, { status: 400 });
        }
        noteType = 'status_change';
        previousStatus = disputeCase.status;
        newStatus = payload.status;
        caseUpdates.status = payload.status;
        if (payload.status === 'resolved') caseUpdates.resolution_timestamp = new Date().toISOString();
        noteContent = noteContent || `Status changed to ${payload.status}.`;
        break;
      case 'assign_to_me':
        noteType = 'assignment';
        caseUpdates.assigned_admin_id = user.id;
        noteContent = noteContent || `Assigned to ${user.full_name || user.email}.`;
        break;
      case 'set_resolution':
        if (!payload.resolution || !payload.resolution.trim()) {
          return Response.json({ error: 'resolution is required' }, { status: 400 });
        }
        noteType = 'status_change';
        previousStatus = disputeCase.status;
        newStatus = 'resolved';
        caseUpdates.status = 'resolved';
        caseUpdates.resolution = payload.resolution;
        caseUpdates.resolution_timestamp = new Date().toISOString();
        noteContent = noteContent || `Resolution recorded: ${payload.resolution}`;
        break;
    }

    let updatedCase = disputeCase;
    if (Object.keys(caseUpdates).length > 0) {
      updatedCase = await base44.asServiceRole.entities.DisputeCase.update(caseId, caseUpdates);
    }

    const note = await base44.asServiceRole.entities.DisputeCaseNote.create({
      case_id: caseId,
      author_role: 'admin',
      author_id: user.id,
      author_name: user.full_name || user.email || 'Admin',
      note_type: noteType,
      content: noteContent,
      previous_status: previousStatus,
      new_status: newStatus,
    });

    if (action === 'escalate') {
      base44.asServiceRole.entities.User.filter({ role: 'admin' })
        .then((admins) =>
          Promise.all(
            admins.map((admin) =>
              base44.asServiceRole.integrations.Core.SendEmail({
                to: admin.email,
                subject: `Dispute Case #${disputeCase.case_number} Escalated`,
                body: `Case #${disputeCase.case_number} has been escalated and marked high priority.\n\n${noteContent}`,
              }).catch(() => {})
            )
          )
        )
        .catch(() => {});
    }

    return Response.json({ case: updatedCase, note });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});