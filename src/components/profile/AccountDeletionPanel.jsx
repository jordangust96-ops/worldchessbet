import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function AccountDeletionPanel() {
  const [request,setRequest]=useState(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [open,setOpen]=useState(false);
  const [confirmation,setConfirmation]=useState("");
  const [error,setError]=useState("");
  const inFlight=useRef(false);
  const load=async()=>{
    setLoading(true);setError("");
    try { const {data}=await base44.functions.invoke("manage-account-deletion",{action:"status"});setRequest(data.request); }
    catch {setError("We couldn't check your deletion request. Retry or contact hello@worldchessbet.com.");}
    finally{setLoading(false);}
  };
  useEffect(()=>{load();},[]);
  const submit=async()=>{
    if(inFlight.current || confirmation!=="DELETE MY ACCOUNT")return;
    inFlight.current=true;setBusy(true);setError("");
    try {
      const {data}=await base44.functions.invoke("manage-account-deletion",{action:"request",confirm:confirmation});
      if(!data.request?.id)throw new Error("not_recorded");
      setRequest(data.request);setOpen(false);setConfirmation("");
    }catch{setError("Your request could not be confirmed. Retry to check for an existing request, or contact hello@worldchessbet.com.");}
    finally{inFlight.current=false;setBusy(false);}
  };
  const pending=request && request.status!=="completed";
  return <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 space-y-3">
    <h2 className="text-base font-semibold text-white">Delete account and personal data</h2>
    <p className="text-sm leading-6 text-white/60">Request deletion of your ChessBet account and personal data we are not required to keep. Support reviews financial and compliance obligations before completing deletion.</p>
    <p className="text-xs leading-5 text-white/45">We aim to complete requests within 30 days and will explain any additional time needed. Transaction, identity, authorization and dispute records may need to remain under applicable legal or processing requirements. Active games, pending transfers and holds are not cancelled or bypassed by a deletion request. Your account remains accessible while the request is reviewed.</p>
    {request && <div role="status" className="rounded-xl border border-[#C9A84C]/25 p-3 text-sm text-white/70">
      <p className="font-semibold capitalize">Request {request.status.replaceAll("_"," ")}</p>
      <p className="mt-1 text-xs break-all">Reference: {request.id}</p>
      <p className="mt-2">{request.player_message}</p>
      {request.retention_summary && <p className="mt-2 text-xs">{request.retention_summary}</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={loading || busy} onClick={load}>{loading?"Checking…":"Refresh request status"}</Button>
      {!pending && !error && <AlertDialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}>
        <AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={loading || busy}>Request account deletion</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Request account deletion?</AlertDialogTitle>
            <AlertDialogDescription>This records a deletion request for your signed-in account. It does not immediately delete data, close your wallet, transfer funds or stop a live game. Support will review the request, explain any retained records, and confirm completion.</AlertDialogDescription></AlertDialogHeader>
          <label className="text-sm">Type DELETE MY ACCOUNT to confirm
            <input autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="mt-2 w-full rounded-lg border border-white/20 bg-black/30 p-3 text-white" disabled={busy}/>
          </label>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy || confirmation!=="DELETE MY ACCOUNT"} onClick={e=>{e.preventDefault();submit();}}>{busy?"Recording…":"Submit deletion request"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
    </div>
    <p className="text-xs text-white/45">Need help or unable to sign in? <a className="underline" href="mailto:hello@worldchessbet.com">Contact support</a>. <Link className="underline" to="/privacy-policy">Privacy policy</Link>.</p>
  </section>;
}
