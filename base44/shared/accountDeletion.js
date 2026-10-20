// Deletion requests are deliberately separate from financial account closure.
// No method here cancels games, submits transfers, deletes records, or changes
// identity/eligibility. Trained staff fulfill erasure using the documented runbook.
const OPEN = ['requested', 'in_review', 'awaiting_settlement'];
function publicRequest(row) {
  if (!row) return null;
  return Object.fromEntries(['id','requested_at','target_date','status','reviewed_at','completed_at','player_message','retention_summary']
    .filter(key => row[key] !== undefined).map(key => [key,row[key]]));
}
const response = (status, body) => ({status,body});
export async function accountDeletionAction({user, body = {}, store, now = new Date()}) {
  if (!user?.id) return response(401,{error:'unauthorized'});
  const action = body.action || 'status';
  if (action === 'status') {
    const rows = await store.forUser(user.id);
    return response(200,{request:publicRequest(rows[0])});
  }
  if (action === 'request') {
    // A request records intent only. It cannot be used to bypass settlement,
    // erase anti-fraud evidence, or close another person's account.
    if (body.confirm !== 'DELETE MY ACCOUNT') return response(400,{error:'confirmation_required'});
    const existing = (await store.forUser(user.id)).find(row=>OPEN.includes(row.status));
    if (existing) return response(200,{request:publicRequest(existing),already_requested:true});
    const created = await store.create({
      user_id:user.id,contact_email:user.email || '',status:'requested',
      requested_at:now.toISOString(),target_date:new Date(now.getTime()+30*86400000).toISOString(),
      player_message:'Your deletion request is recorded. We aim to complete it within 30 days. If settlement or required retention affects timing, support will explain what remains and why.',
    });
    return response(200,{request:publicRequest(created)});
  }
  // The HTTP adapter additionally enforces the existing administrator MFA gate.
  if (user.role !== 'admin') return response(403,{error:'forbidden'});
  if (action === 'list') {
    const limit = 50;
    const skip = Number(body.skip || 0);
    if (!Number.isInteger(skip) || skip < 0 || skip > 100000) return response(400,{error:'invalid_page'});
    const rows = await store.list(limit+1,skip);
    return response(200,{requests:rows.slice(0,limit),has_more:rows.length>limit,next_skip:skip+limit});
  }
  if (action !== 'review') return response(400,{error:'invalid_action'});
  if (typeof body.requestId !== 'string' || !body.requestId) return response(400,{error:'invalid_request'});
  const row = await store.get(body.requestId);
  if (!row) return response(404,{error:'request_not_found'});
  if (row.status === 'completed') return response(409,{error:'request_already_completed'});
  if (!['in_review','awaiting_settlement','completed'].includes(body.status)) return response(400,{error:'invalid_status'});
  const message = String(body.playerMessage || '').trim();
  if (message.length < 10 || message.length > 1500) return response(400,{error:'explanation_required'});
  const patch = {status:body.status,player_message:message,reviewed_at:now.toISOString(),reviewed_by:user.id};
  if (body.status === 'completed') {
    const reference = String(body.completionReference || '').trim();
    const retention = String(body.retentionSummary || '').trim();
    if (!['in_review','awaiting_settlement'].includes(row.status) ||
      body.appleAccessHandled !== true || body.associatedDataHandled !== true || body.confirmationSent !== true ||
      reference.length < 10 || reference.length > 2000 || retention.length < 10 || retention.length > 3000)
      return response(409,{error:'completion_evidence_required'});
    // A human checkbox cannot declare an existing authentication record deleted.
    // Only an explicit 404 is absence; timeouts, permission and provider errors fail closed.
    if (!await store.authUserMissing(row.user_id)) return response(409,{error:'authentication_record_still_exists'});
    Object.assign(patch,{completed_at:now.toISOString(),completion_reference:reference,retention_summary:retention,
      apple_access_handled:true,associated_data_handled:true,confirmation_sent:true});
  }
  const updated = await store.update(row.id,patch);
  return response(200,{request:publicRequest(updated)});
}
