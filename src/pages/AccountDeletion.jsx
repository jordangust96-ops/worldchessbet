import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import AccountDeletionPanel from "@/components/profile/AccountDeletionPanel";
export default function AccountDeletion(){
  const [state,setState]=useState("loading");
  useEffect(()=>{base44.auth.me().then(()=>setState("signed_in")).catch(()=>setState("signed_out"));},[]);
  return <main className="min-h-screen bg-[#0A0A0A] px-5 py-10"><div className="mx-auto max-w-2xl space-y-5">
    <Link to="/" className="text-sm text-[#C9A84C]">ChessBet home</Link>
    <h1 className="text-2xl font-bold text-white">Account deletion</h1>
    {state==="loading"?<p className="text-white/60">Checking sign-in…</p>:state==="signed_in"?<AccountDeletionPanel/>:
      <div className="space-y-4 text-white/65"><p>Sign in to submit and track an account and personal-data deletion request. We aim to complete requests within 30 days and explain any additional time needed for settlement or required retention.</p>
      <p>Financial, identity, authorization and dispute records may need to be retained. Deletion does not bypass pending payments, holds or active games.</p>
      <Link to="/login" className="inline-block rounded-xl bg-[#C9A84C] px-4 py-3 font-semibold text-black">Sign in</Link>
      <p>If you cannot sign in, contact <a className="underline" href="mailto:hello@worldchessbet.com">hello@worldchessbet.com</a> to initiate deletion. Do not email passwords, bank details or identity documents.</p></div>}
  </div></main>;
}
