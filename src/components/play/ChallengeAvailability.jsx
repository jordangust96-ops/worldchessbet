import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { challengeRequest, challengeErrorMessage } from '@/lib/challengeApi';
import { CHALLENGE_HUD_TERMS, CHALLENGE_HUD_CONSENT_VERSION } from '../../../base44/shared/challengePolicy.js';

// Mounted only for the creator's visible, open challenge. Never reserves funds.
export default function ChallengeAvailability({ card, onChanged }) {
  const [agree,setAgree]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [generation,setGeneration]=useState(0);
  const consentRequired=card.creatorConsentRequired!==false;
  useEffect(()=>{
    if(consentRequired || card.status!=='open')return;
    let disposed=false, pending=null, retryAt=0;
    const body={inviteCode:card.inviteCode,presenceId:crypto.randomUUID()};
    const leave=()=>challengeRequest('presence',{...body,visible:false}).catch(()=>{});
    const update=async()=>{
      if(disposed || pending || document.visibilityState!=='visible' || Date.now()<retryAt)return;
      pending=challengeRequest('presence',{...body,visible:true});
      try{await pending;if(!disposed)setError('');}
      catch(err){retryAt=Date.now()+20000;if(!disposed && !['funds_required','bank_required','identity_required','busy','unavailable'].includes(err?.response?.data?.code))setError(challengeErrorMessage(err));}
      finally{pending=null;if(disposed || document.visibilityState!=='visible')await leave();}
    };
    const visibility=()=>{if(document.visibilityState==='visible')setGeneration(value=>value+1);else leave();};
    const pagehide=()=>leave();
    update();const timer=setInterval(update,3000);
    document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);
    return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);leave();};
  },[card.id,card.inviteCode,card.status,consentRequired,generation]);
  const confirm=async()=>{
    setBusy(true);setError('');
    try{await challengeRequest('consent',{inviteCode:card.inviteCode,agree,consentVersion:CHALLENGE_HUD_CONSENT_VERSION,entryAmount:card.entryAmount,serviceFee:card.serviceFee});await onChanged?.();}
    catch(err){setError(challengeErrorMessage(err));}finally{setBusy(false);}
  };
  return <>
    {consentRequired && <div className="space-y-3 rounded-xl border border-white/10 p-3">
      <p className="text-sm text-white/65">Confirm the terms once to make this existing challenge available from your HUD.</p>
      <label className="flex items-start gap-2 text-xs leading-relaxed text-white/60"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} className="mt-1"/><span>{CHALLENGE_HUD_TERMS}</span></label>
      <Button onClick={confirm} disabled={!agree || busy} className="w-full rounded-xl gold-gradient font-semibold text-black">Confirm Challenge Terms</Button>
    </div>}
    {error && <p role="status" className="text-xs text-[#E5CA7A]">{error}</p>}
  </>;
}
