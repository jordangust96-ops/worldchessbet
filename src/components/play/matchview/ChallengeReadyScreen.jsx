import React, { useEffect, useRef, useState } from 'react';
import { Check, Clock, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { challengeRequest, challengeLocationContext, challengeErrorMessage, handleChallengeGate } from '@/lib/challengeApi';

export default function ChallengeReadyScreen({ match, userId, opponentId, onCancel, onRefresh }) {
  const navigate = useNavigate();
  const [name,setName] = useState('Opponent');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [armed,setArmed] = useState(false);
  const [now,setNow] = useState(Date.now());
  const inFlight = useRef(false);
  const isP1 = match.player1_id === userId;
  const myAt = Date.parse(match[isP1 ? 'challenge_player1_ready_at' : 'challenge_player2_ready_at'] || '');
  const otherAt = Date.parse(match[isP1 ? 'challenge_player2_ready_at' : 'challenge_player1_ready_at'] || '');
  const myReady = myAt <= now && now-myAt < 30000;
  const otherReady = otherAt <= now && now-otherAt < 30000;
  const remaining = Math.max(0,Math.ceil((Date.parse(match.preparation_started_at)+120000-now)/1000));
  const total = Math.round((Number(match.wager_amount)+Number(match.platform_service_fee))*100)/100;
  useEffect(()=>{
    base44.functions.invoke('getUserDisplayNames',{userIds:[opponentId]}).then(({data})=>setName(data?.names?.[opponentId] || 'Opponent')).catch(()=>{});
  },[opponentId]);
  useEffect(()=>{
    const timer=setInterval(()=>setNow(Date.now()),1000);
    const hide=()=>{ if(document.visibilityState!=='visible')setArmed(false); };
    document.addEventListener('visibilitychange',hide);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',hide);};
  },[]);
  useEffect(()=>{
    let active=true;
    const maintain=async()=>{
      if(inFlight.current || document.visibilityState!=='visible')return;
      inFlight.current=true;
      try {
        if(remaining===0) {
          await challengeRequest('recover',{matchId:match.id});
        } else {
          if(armed) {
            const heartbeat=await challengeRequest('heartbeat',{matchId:match.id,visible:true});
            if(heartbeat.needsReady && active)setArmed(false);
          }
          if(myReady && otherReady) await challengeRequest('finalize',{matchId:match.id});
        }
        await onRefresh?.();
      } catch(err) {
        const action=err?.response?.data?.action;
        if(active && action==='location_required') {setArmed(false);setError('Please confirm readiness again to refresh your location.');}
        else if(active && action==='recovery_pending') {
          setError('Confirming the existing reservation. No additional funds are being reserved.');
          try { await challengeRequest('recover',{matchId:match.id}); await onRefresh?.(); } catch { /* Retry through the existing sweep. */ }
        }
        else if(active && !['busy','wallet_busy','retry'].includes(action)) setError(challengeErrorMessage(err));
      } finally{inFlight.current=false;}
    };
    maintain();
    const timer=setInterval(maintain,5000);
    return()=>{active=false;clearInterval(timer);};
  },[match.id,armed,myReady,otherReady,remaining===0,onRefresh]);
  const ready=async()=>{
    if(busy || remaining===0)return;
    setBusy(true);setError('');
    try {
      await challengeRequest('ready',{matchId:match.id,...await challengeLocationContext()});
      setArmed(true);await onRefresh?.();
      await challengeRequest('finalize',{matchId:match.id});await onRefresh?.();
    } catch(err) {
      if(!handleChallengeGate(err,navigate,`/play?match=${match.id}`))setError(challengeErrorMessage(err));
    } finally{setBusy(false);}
  };
  const cancel=async()=>{
    if(busy)return;setBusy(true);setError('');
    try{await onCancel();await onRefresh?.();}catch(err){setError(challengeErrorMessage(err));}finally{setBusy(false);}
  };
  return <section className="space-y-4">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-[#C9A84C]">Challenge accepted</p><h2 className="mt-1 text-xl font-bold text-white">Ready to play?</h2></div>
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-3 py-2 text-xs text-white/65"><Clock size={13}/>{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</span></div>
    <div className="rounded-2xl border border-[#C9A84C]/25 bg-[#C9A84C]/5 p-4">
      <p className="font-semibold text-white">${Number(match.wager_amount).toFixed(2)} · {match.display_name}</p>
      <p className="mt-2 text-sm text-white/60">Both entries and both service fees are reserved. Your total reservation is ${total.toFixed(2)}.</p>
      <p className="mt-2 text-xs leading-relaxed text-white/45">No further deposit or reservation is required. The game starts only when both players confirm and remain present.</p>
    </div>
    {[['You',myReady], [name,otherReady]].map(([label,readyState])=><div key={String(label)} className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-sm"><span className="text-white/75">{label}</span><span className={readyState?'text-[#C9A84C]':'text-white/40'}>{readyState ? <><Check className="mr-1 inline" size={14}/>Ready</> : 'Not ready yet'}</span></div>)}
    {remaining>0 ? <>
      <Button onClick={ready} disabled={busy || (armed && myReady)} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black disabled:opacity-60">{busy && <Loader2 size={16} className="mr-2 animate-spin"/>}{armed && myReady?'Waiting for opponent…':'I’m Ready'}</Button>
      <p className="text-center text-xs text-white/45">Stay on this screen after confirming. Leaving makes readiness expire; it does not start your clock.</p>
    </> : <p className="rounded-xl bg-white/5 p-3 text-sm text-white/60">The start window ended. The system is closing this unstarted match and releasing both entries and fees.</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <Button onClick={cancel} disabled={busy} variant="outline" className="h-10 w-full rounded-xl border-white/15 text-white/55">Cancel Before Start</Button>
  </section>;
}
