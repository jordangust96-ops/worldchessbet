import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Admin-only actions on an existing IntegrityFlag. Every action writes an
// immutable IntegrityAuditLog entry. No action here ever automatically bans
// or suspends a user — freezing withdrawals only sets a hold flag that an
// admin must explicitly apply and later lift.
const VALID_ACTIONS = [
  'mark_under_review',
  'mark_cleared',
  'mark_action_taken',
  'add_notes',
  'freeze_withdrawals',
  'unfreeze_withdrawals',
  'request_identity_verification',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { flagId, action, notes } = await req.json();
    if (!flagId || !VALID_ACTIONS.includes(action)) {
      return Response.json({ error: 'A valid flagId and action are required' }, { status: 400 });
    }

    const flag = await base44.asServiceRole.entities.IntegrityFlag.get(flagId);
    if (!flag) return Response.json({ error: 'Flag not found' }, { status: 404 });

    const previousStatus = flag.status;
    let newStatus = previousStatus;
    const flagUpdates = { assigned_admin_id: admin.id };
    let notifyUser = null;

    if (action === 'mark_under_review') {
      newStatus = 'under_review';
      flagUpdates.status = newStatus;
    } else if (action === 'mark_cleared') {
      newStatus = 'cleared';
      flagUpdates.status = newStatus;
    } else if (action === 'mark_action_taken') {
      newStatus = 'action_taken';
      flagUpdates.status = newStatus;
      if (notes) flagUpdates.action_taken = notes;
    } else if (action === 'add_notes') {
      flagUpdates.notes = flag.notes ? `${flag.notes}\n\n${notes}` : notes;
    } else if (action === 'freeze_withdrawals') {
      await base44.asServiceRole.entities.User.update(flag.user_id, { withdrawal_hold: true });
      notifyUser = {
        subject: 'ChessBet Account Notice',
        body: 'A temporary hold has been placed on withdrawals from your ChessBet account while we complete a routine integrity review. This is not a suspension, and your account remains otherwise active. We will notify you once the review is complete.',
      };
    } else if (action === 'unfreeze_withdrawals') {
      await base44.asServiceRole.entities.User.update(flag.user_id, { withdrawal_hold: false });
    } else if (action === 'request_identity_verification') {
      await base44.asServiceRole.entities.User.update(flag.user_id, { identity_verification_status: 'pending' });
      notifyUser = {
        subject: 'ChessBet Identity Verification Requested',
        body: 'As part of a routine account review, ChessBet is requesting additional identity verification. Please contact ChessBet Support to complete this step.',
      };
    }

    const updatedFlag = await base44.asServiceRole.entities.IntegrityFlag.update(flagId, flagUpdates);

    await base44.asServiceRole.entities.IntegrityAuditLog.create({
      flag_id: flagId,
      admin_id: admin.id,
      admin_name: admin.full_name || admin.email,
      action,
      previous_status: previousStatus,
      new_status: newStatus,
      notes: notes || '',
    });

    if (notifyUser) {
      const targetUser = await base44.asServiceRole.entities.User.get(flag.user_id);
      if (targetUser?.email) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: targetUser.email,
          subject: notifyUser.subject,
          body: notifyUser.body,
        }).catch(() => {});
      }
    }

    return Response.json({ flag: updatedFlag });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});