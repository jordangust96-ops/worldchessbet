import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { getMfaSessionToken } from "@/lib/mfaSession";
import { Button } from "@/components/ui/button";
const messageFor = status => status==="in_review"?"Support is reviewing your deletion request and the records that must be retained.":status==="awaiting_settlement"?"Your deletion request remains open while outstanding transfers, contests or required reviews are resolved. Support will explain the remaining steps.":"Your account and personal data not required for retention have been deleted. Completion confirmation has been sent.";
export default function AdminAccountDeletion(){
  const [rows,setRows]=useState([]),[error,setError]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState(null),[status,setStatus]=useState("in_review"),[message,setMessage]=useState(messageFor("in_review"));
  const [retention,setRetention]=useState(""),[reference,setReference]=useState(""),[checks,setChecks]=useState({});
  const [skip,setSkip]=useState(0),[more,setMore]=useState(false);
  const call=body=>base44.functions.invoke("manage-account-deletion",{...body,mfaSessionToken:getMfaSessionToken()});
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{const {data}=await base44.functions.invoke("manage-account-deletion",{action:"list",skip,mfaSessionToken:getMfaSessionToken()});setRows(data.requests);setMore(data.has_more);}
    catch{setError("Unable to load deletion requests. Check administrator access and MFA, then retry.");}
    finally{setLoading(false);}
  },[skip]);
  useEffect(()=>{load();},[load]);
  const save=async()=>{
    if(busy || !selected)return;setBusy(true);setError("");
    try{
      await call({action:"review",requestId:selected.id,status,playerMessage:message,retentionSummary:retention,completionReference:reference,
        appleAccessHandled:checks.apple,associatedDataHandled:checks.data,confirmationSent:checks.confirmation});
      setSelected(null);await load();
    }catch(e){setError(e?.response?.data?.error==="authentication_record_still_exists"?"Cannot mark complete: the Base44 authentication/user record still exists.":e?.response?.data?.error==="completion_evidence_required"?"Complete the review and record all fulfillment evidence before marking deletion complete.":"Unable to update this request. No financial action was performed.");}
    finally{setBusy(false);}
  };
  const choose=row=>{setSelected(row);setStatus("in_review");setMessage(messageFor("in_review"));setRetention("");setReference("");setChecks({});};
  return <main className="min-h-screen bg-[#0A0A0A] p-5 text-white"><div className="mx-auto max-w-4xl space-y-5">
    <Link to="/profile" className="text-sm text-[#C9A84C]">Back to Profile</Link><h1 className="text-2xl font-bold">Account deletion requests</h1>
    <div className="rounded-xl border border-amber-400/25 p-4 text-sm leading-6 text-white/65">
      <p>Review each request manually. This page never moves money, changes eligibility, closes accounts or deletes records.</p>
      <ol className="list-decimal pl-5"><li>Explain timing and confirm ownership. Review outstanding games, balances, transfers, holds and disputes using existing tools.</li>
      <li>Return funds only through existing authorized payout/closure controls. Preserve required financial, identity and authorization evidence with a documented retention basis and review date.</li>
      <li>Delete data not required for retention from ChessBet and affected providers. Remove the Base44 app user/authentication record only after settlement and retention review.</li>
      <li>Handle Sign in with Apple revocation through Base44/provider support. If tokens are unavailable, follow Apple's documented manual-revocation instructions and tell the player.</li>
      <li>Send the player a completion notice describing retained categories and reasons. Record the case/evidence reference below. Mark complete only after fulfillment.</li></ol>
      <a className="underline" target="_blank" rel="noopener noreferrer" href="https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple">Apple deletion and token-revocation guidance</a>
    </div>
    {error&&<p role="alert" className="text-red-300">{error}</p>}
    <Button variant="outline" onClick={load} disabled={loading || busy}>{loading?"Loading…":"Refresh requests"}</Button>
    {!loading&&!rows.length&&!error&&<p>No deletion requests on this page.</p>}
    {rows.map(row=><article key={row.id} className="rounded-xl border border-white/10 p-4 space-y-2">
      <p className="break-all font-semibold">{row.contact_email || row.user_id}</p><p className="text-xs break-all">Reference: {row.id} · User: {row.user_id}</p>
      <p className="capitalize text-sm">{row.status.replaceAll("_"," ")}</p><p className="text-xs text-white/50">Requested {new Date(row.requested_at).toLocaleString()} · Target {new Date(row.target_date).toLocaleDateString()}</p>
      {row.status!=="completed"&&Date.parse(row.target_date)<Date.now()&&<p className="text-amber-300">Past target date—contact the player with an update.</p>}
      {row.status!=="completed"&&<Button variant="outline" onClick={()=>choose(row)} disabled={busy}>Review request</Button>}
    </article>)}
    <div className="flex gap-3"><Button variant="outline" disabled={skip===0||loading||busy} onClick={()=>setSkip(Math.max(0,skip-50))}>Previous</Button><Button variant="outline" disabled={!more||loading||busy} onClick={()=>setSkip(skip+50)}>Next</Button></div>
    {selected&&<section className="rounded-xl border border-[#C9A84C]/30 p-5 space-y-4">
      <h2 className="font-semibold">Review request {selected.id}</h2>
      <label className="block text-sm">Status<select className="ml-3 rounded border border-white/20 bg-black p-2" value={status} onChange={e=>{setStatus(e.target.value);setMessage(messageFor(e.target.value));}}>
        <option value="in_review">In review</option><option value="awaiting_settlement">Awaiting settlement/review</option><option value="completed">Completed after fulfillment</option></select></label>
      <label className="block text-sm">Explanation for the player<textarea maxLength={1500} className="mt-2 w-full rounded border border-white/20 bg-black p-3" value={message} onChange={e=>setMessage(e.target.value)}/></label>
      {status==="completed"&&<>
        <label className="block text-sm">Retained categories, legal/processor basis and retention review date<textarea maxLength={3000} className="mt-2 w-full rounded border border-white/20 bg-black p-3" value={retention} onChange={e=>setRetention(e.target.value)}/></label>
        <label className="block text-sm">Fulfillment case/evidence reference (no credentials or identity documents)<textarea maxLength={2000} className="mt-2 w-full rounded border border-white/20 bg-black p-3" value={reference} onChange={e=>setReference(e.target.value)}/></label>
        {[["data","Non-required associated data was deleted; required records were reviewed and preserved."],["apple","Apple access was revoked, or documented manual instructions were provided where tokens are unavailable (or Apple was not used)."],["confirmation","The player was sent a deletion-completion notice explaining retained records."]].map(([key,label])=><label key={key} className="flex gap-3 text-sm"><input type="checkbox" checked={checks[key]===true} onChange={e=>setChecks({...checks,[key]:e.target.checked})}/>{label}</label>)}
      </>}
      <div className="flex gap-2"><Button disabled={busy||message.trim().length<10} onClick={save}>{busy?"Saving…":"Save review"}</Button><Button variant="outline" disabled={busy} onClick={()=>setSelected(null)}>Cancel</Button></div>
    </section>}
  </div></main>;
}
