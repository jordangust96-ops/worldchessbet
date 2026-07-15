import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const VALID_ACTIONS = ['assign_to_me', 'change_status', 'add_notes'];
const VALID_STATUSES = ['submitted', 'under_review', 'additional_information_requested', 'granted', 'denied', 'closed'];

// Administrator-only actions on a CaseAppeal. Appeals live in their own
// review queue and never overwrite the original CaseResolution — granting or
// denying an appeal only updates the CaseAppeal record itself, plus an
// append-only DisputeCaseNote on the original case for audit purposes.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { appealId, action, payload = {} } = await req.json();
    if (!appealId) return Response.json({ error: 'appealId is required' }, { status: 400 });
    if (!VALID_ACTIONS.includes(action)) return Response.json({ error: 'Invalid action' }, { status: 400 });

    const appeal = await base44.asServiceRole.entities.CaseAppeal.get(appealId);
    if (!appeal) return Response.json({ error: 'Appeal not found' }, { status: 404 });

    const appealUpdates = {};
    let noteContent = '';

    if (action === 'assign_to_me') {
      appealUpdates.assigned_admin_id = admin.id;
      noteContent = `Appeal for Case #CB-${String(appeal.case_number).padStart(6, '0')} assigned to ${admin.full_name || admin.email}.`;
    } else if (action === 'change_status') {
      if (!VALID_STATUSES.includes(payload.status)) {
        return Response.json({ error: 'Invalid status' }, { status: 400 });
      }
      appealUpdates.status = payload.status;
      if (payload.notes) appealUpdates.resolution_notes = payload.notes;
      if (['granted', 'denied', 'closed'].includes(payload.status)) {
        appealUpdates.resolved_at = new Date().toISOString();
      }
      noteContent = `Appeal ${payload.status.replace(/_/g, ' ')}.${payload.notes ? ' ' + payload.notes : ''}`;
    } else if (action === 'add_notes') {
      if (!payload.notes || !payload.notes.trim()) {
        return Response.json({ error: 'notes is required' }, { status: 400 });
      }
      appealUpdates.resolution_notes = appeal.resolution_notes ? `${appeal.resolution_notes}\n\n${payload.notes}` : payload.notes;
      noteContent = `Appeal note added: ${payload.notes}`;
    }

    const updatedAppeal = await base44.asServiceRole.entities.CaseAppeal.update(appealId, appealUpdates);

    const disputeCase = await base44.asServiceRole.entities.DisputeCase.get(appeal.case_id).catch(() => null);
    if (disputeCase) {
      await base44.asServiceRole.entities.DisputeCaseNote.create({
        case_id: appeal.case_id,
        reporting_user_id: disputeCase.reporting_user_id,
        author_role: 'admin',
        author_id: admin.id,
        author_name: admin.full_name || admin.email || 'Admin',
        action_type: 'appeal_resolved',
        content: noteContent,
        visible_to_user: ['granted', 'denied', 'closed'].includes(appealUpdates.status || ''),
      });

      // Notify the appealing user once a final decision is reached.
      if (['granted', 'denied'].includes(appealUpdates.status || '')) {
        const appealingUser = await base44.asServiceRole.entities.User.get(appeal.appealing_user_id).catch(() => null);
        if (appealingUser?.email) {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: appealingUser.email,
            subject: `Appeal Decision — Case #CB-${String(appeal.case_number).padStart(6, '0')}`,
            body: `Your appeal for Case #CB-${String(appeal.case_number).padStart(6, '0')} has been ${appealUpdates.status}.`,
          }).catch(() => {});
        }
      }
    }

    return Response.json({ appeal: updatedAppeal });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});