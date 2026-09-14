import React, { useEffect, useRef, useState } from 'react';
import { Check, Clock, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { CHALLENGE_READY_MS, FAIR_PLAY_ATTESTATION_VERSION, challengeStartDeadline } from '../../../../base44/shared/challengePolicy.js';
import { challengeRequest, challengeLocationContext, challengeErrorMessage, handleChallengeGate } from '@/lib/challengeApi';

export default function ChallengeReadyScreen({ match, userId, opponentId, onCancel, onRefresh }) {
  const navigate = useNavigate();
  const free=match.play_mode==='free';
  useEffect(()=>{setAgree(false);},[match.id]);
  const [name,setName] = useState('Opponent');
  const [agree,setAgree] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [armed,setArmed] = useState(false);
  const [now,setNow] = useState(Date.now());
  const inFlight = useRef(false);
  const actionBusy = useRef(false);
  const maintenanceDone = useRef(Promise.resolve());
  const presenceId = useRef(crypto.randomUUID());
  const present = useRef(true);
  const armedRef = useRef(false);
  const isP1 = match.player1_id === userId;
  const myAt = Date.parse(match[isP1 ? 'challenge_player1_ready_at' : 'challenge_player2_ready_at'] || '');
  const otherAt = Date.parse(match[isP1 ? 'challenge_player2_ready_at' : 'challenge_player1_ready_at'] || '');
  const myReady = myAt <= now && now-myAt < CHALLENGE_READY_MS;
  const otherReady = otherAt <= now && now-otherAt < CHALLENGE_READY_MS;
  const remaining = Math.max(0,Math.ceil((challengeStartDeadline(match)-now)/1000));
  const total = Math.round((Number(match.wager_amount)+Number(match.platform_service_fee))*100)/100;
  useEffect(()=>{
    base44.functions.invoke('getUserDisplayNames',{userIds:[opponentId]}).then(({data})=>setName(data?.names?.[opponentId] || 'Opponent')).catch(()=>{});
  },[opponentId]);
  useEffect(()=>{
    const timer=setInterval(()=>setNow(Date.now()),1000);
    const withdraw=()=>{present.current=false;armedRef.current=false;setArmed(false);challengeRequest('unready',{matchId:match.id,presenceId:presenceId.current}).catch(()=>{});};
    const hide=()=>{if(document.visibilityState!=='visible')withdraw();else present.current=true;};
    window.addEventListener('pagehide',withdraw);
    document.addEventListener('visibilitychange',hide);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',withdraw);withdraw();};
  },[match.id]);
  useEffect(()=>{
    let active=true;
    const maintain=async()=>{
      if(inFlight.current || actionBusy.current || document.visibilityState!=='visible')return;
      inFlight.current=true;
      let finishMaintenance;
      maintenanceDone.current=new Promise(resolve=>{finishMaintenance=resolve;});
      try {
        if(remaining===0) {
          await challengeRequest('recover',{matchId:match.id});
        } else {
          if(armedRef.current && present.current) {
            const heartbeat=await challengeRequest('heartbeat',{matchId:match.id,visible:true,presenceId:presenceId.current});
            if(heartbeat.needsReady && active){armedRef.current=false;setArmed(false);}
            if(!present.current || document.visibilityState!=='visible'){await challengeRequest('unready',{matchId:match.id,presenceId:presenceId.current});return;}
          }
          if(armedRef.current && present.current && document.visibilityState==='visible' && myReady && otherReady) await challengeRequest('finalize',{matchId:match.id});
        }
        await onRefresh?.();
      } catch(err) {
        const action=err?.response?.data?.action;
        if(active && action==='location_required') {armedRef.current=false;setArmed(false);setError('Please confirm readiness again to refresh your location.');}
        else if(active && action==='recovery_pending') {
          setError('Confirming the existing reservation. No additional funds are being reserved.');
          try { await challengeRequest('recover',{matchId:match.id}); await onRefresh?.(); } catch { /* Retry through the existing sweep. */ }
        }
        else if(active && !['busy','wallet_busy','retry'].includes(action)) setError(challengeErrorMessage(err));
      } finally{inFlight.current=false;finishMaintenance();}
    };
    maintain();
    const timer=setInterval(maintain,3000);
    return()=>{active=false;clearInterval(timer);};
  },[match.id,armed,myReady,otherReady,remaining===0,onRefresh]);
  const ready=async()=>{
    if(actionBusy.current || remaining===0 || !agree)return;
    actionBusy.current=true;
    setBusy(true);setError('');
    try {
      await maintenanceDone.current;
      const context=free?{}:await challengeLocationContext();
      if(!present.current || document.visibilityState!=='visible')return;
      await challengeRequest('ready',{matchId:match.id,presenceId:presenceId.current,agree,attestationVersion:FAIR_PLAY_ATTESTATION_VERSION,...context});
      if(!present.current || document.visibilityState!=='visible'){await challengeRequest('unready',{matchId:match.id,presenceId:presenceId.current});return;}
      armedRef.current=true;setArmed(true);await onRefresh?.();
      if(!present.current || document.visibilityState!=='visible')return;
      await challengeRequest('finalize',{matchId:match.id});await onRefresh?.();
    } catch(err) {
      if(!handleChallengeGate(err,navigate,`/play?match=${match.id}`))setError(challengeErrorMessage(err));
    } finally{actionBusy.current=false;setBusy(false);}
  };
  const cancel=async()=>{
    if(actionBusy.current)return;actionBusy.current=true;setBusy(true);setError('');
    try{await maintenanceDone.current;await onCancel();await onRefresh?.();}catch(err){setError(challengeErrorMessage(err));}finally{actionBusy.current=false;setBusy(false);}
  };
  return <section className="space-y-4">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-[#C9A84C]">Challenge accepted</p><h2 className="mt-1 text-xl font-bold text-white">Ready to play?</h2></div>
      <span aria-label="Time remaining to start" className="flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-3 py-2 text-xs text-white/65"><Clock size={13}/>{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</span></div>
    <div className="rounded-2xl border border-[#C9A84C]/25 bg-[#C9A84C]/5 p-4">
      <p className="font-semibold text-white">{free?'Free play':`$${Number(match.wager_amount).toFixed(2)}`} · {match.display_name}</p>
      <p className="mt-2 text-sm text-white/60">{free?'Both players must be ready before the game starts.':`Both entries and both service fees are reserved. Your total reservation is $${total.toFixed(2)}.`}</p>
      <p className="mt-2 text-xs leading-relaxed text-white/45">The creator has five minutes from acceptance to return. Both players must confirm readiness before the game starts.</p>
    </div>
    {[['You',myReady], [name,otherReady]].map(([label,readyState])=><div key={String(label)} className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-sm"><span className="text-white/75">{label}</span><span className={readyState?'text-[#C9A84C]':'text-white/40'}>{readyState ? <><Check className="mr-1 inline" size={14}/>Ready</> : 'Not ready yet'}</span></div>)}
    {remaining>0 ? <>
      <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-xs leading-relaxed text-white/65"><input type="checkbox" checked={agree} disabled={busy || (armed && myReady)} onChange={e=>setAgree(e.target.checked)} className="mt-0.5"/><span>I will play fairly, without chess engines, AI, or outside assistance.</span></label>
      <Button onClick={ready} disabled={busy || !agree || (armed && myReady)} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black disabled:opacity-60">{busy && <Loader2 size={16} className="mr-2 animate-spin"/>}{armed && myReady?'Waiting for opponent…':'I’m Ready'}</Button>
      <p className="text-center text-xs text-white/45">Stay on this screen after confirming. Leaving withdraws your readiness; both players must be present to start.</p>
    </> : <p className="rounded-xl bg-white/5 p-3 text-sm text-white/60">{free?'The start window ended. This unstarted free game is closing.':'The start window ended. The system is closing this unstarted match and releasing both entries and fees.'}</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <Button onClick={cancel} disabled={busy} variant="outline" className="h-10 w-full rounded-xl border-white/15 text-white/55">Cancel Before Start</Button>
  </section>;
}