import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Share2, Swords, Plus, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { challengeRequest, challengeErrorMessage } from '@/lib/challengeApi';
import ChallengePanel from '@/components/play/ChallengePanel';
import CreateChallengeForm from '@/components/play/CreateChallengeForm';
import AvailableMatchSection from '@/components/play/AvailableMatchSection';
import ActiveChallengeCard from '@/components/play/ActiveChallengeCard';

export default function ChallengeHub({ userId, balance, onMatchAccepted }) {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedCode = new URLSearchParams(location.search).get("challenge");
  const selectedCode = /^[a-f0-9]{32}$/.test(requestedCode || "") ? requestedCode : "";
  const [creating,setCreating] = useState(false);
  const [showPublic,setShowPublic] = useState(()=>new URLSearchParams(location.search).get('mode')==='public');
  const [challenges,setChallenges] = useState([]);
  const [activePublic,setActivePublic] = useState(null);
  const [loading,setLoading] = useState(true);
  const [loadFailed,setLoadFailed] = useState(false);
  const [error,setError] = useState('');
  const [busyId,setBusyId] = useState('');
  const refresh = useCallback(async()=>{
    if(!userId)return;
    try{
      const [data,publicRows]=await Promise.all([
        challengeRequest('list'),
        base44.entities.Match.filter({launch_epoch:2,player1_id:userId,status:'searching',is_private:{$ne:true}},'-created_date',5),
      ]);
      setChallenges(data.challenges || []);setActivePublic(publicRows[0] || null);setError('');setLoadFailed(false);
    }catch(err){setLoadFailed(true);setError(challengeErrorMessage(err));}finally{setLoading(false);}
  },[userId]);
  useEffect(()=>{
    refresh();
    if(!userId)return;
    const unsubscribe=base44.entities.Match.subscribe(event=>{
      if(event.data?.launch_epoch===2 && event.data?.player1_id===userId)refresh();
    });
    const visible=()=>{if(document.visibilityState==='visible')refresh();};
    const timer=setInterval(visible,20000);
    window.addEventListener('focus',visible);
    return()=>{unsubscribe();clearInterval(timer);window.removeEventListener('focus',visible);};
  },[userId,refresh]);
  const cancel=async card=>{
    setBusyId(card.id);setError('');
    try{await challengeRequest('cancel',{matchId:card.id});await refresh();}catch(err){setError(challengeErrorMessage(err));}finally{setBusyId('');}
  };
  const share=async card=>{
    const url=`${window.location.origin}${card.path}`;
    try{
      if(navigator.share)await navigator.share({title:'ChessBet Challenge',text:`A $${card.entryAmount} chess challenge. Entry plus separate service fee; eligibility and available funds required.`,url});
      else{await navigator.clipboard.writeText(url);setError('Link copied.');}
    }catch(err){if(err?.name!=='AbortError')setError('Open the challenge to copy its link.');}
  };
  const existingChallenge = challenges.find(card => ['open','processing','claimed'].includes(card.status));
  const creationBlocked = loading || loadFailed || Boolean(activePublic) || Boolean(existingChallenge);
  const pendingId = existingChallenge?.id || activePublic?.id || '';
  useEffect(() => {
    if (pendingId) setShowPublic(true);
  }, [pendingId]);

  return <section className="space-y-5 rounded-3xl border border-white/5 bg-gradient-to-br from-[#1A1A1A] to-[#111] p-5 lg:h-full lg:overflow-y-auto lg:p-5">
    {selectedCode ? <ChallengePanel key={selectedCode} inviteCode={selectedCode} embedded onClose={()=>navigate("/play")} onChanged={refresh}/> : loading ? <Loader2 aria-label="Loading your challenge" size={20} className="animate-spin text-white/40"/> : creating && !creationBlocked ? <CreateChallengeForm onCreated={async()=>{ await refresh(); setCreating(false); navigate('/play', { replace:true }); }} onCancel={()=>setCreating(false)}/> : !creationBlocked ? <div className="space-y-3">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#C9A84C]/10 text-[#C9A84C]"><Swords size={21}/></div>
      <div><h1 className="text-2xl font-extrabold text-white">Challenge Someone</h1><p className="mt-2 text-sm leading-relaxed text-white/55">Your friend. Your rival. Your next opponent. Create a link and play chess for money.</p></div>
      <Button disabled={creationBlocked} onClick={()=>setCreating(true)} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black"><Plus size={18} className="mr-2"/>Create Challenge</Button>
      <p className="text-xs leading-relaxed text-white/40">Links reserve no money or opponent. Both players need available funds when the challenge is accepted.</p>
    </div> : null}
    {!selectedCode && !loading && (challenges.length > 0 || activePublic) && <div className="border-t border-white/10 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#C9A84C]/25 bg-[#C9A84C]/10 text-[#E5CA7A]"><Swords size={23}/></div>
        <div><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[#C9A84C]">Challenge posted</p>
          <h2 className="text-xl font-extrabold leading-tight text-white">Your next match starts here</h2></div>
      </div>
      {challenges.length > 0 && <div className="space-y-3">{challenges.map(card=><article key={card.id} className="space-y-3 rounded-2xl border border-[#C9A84C]/20 bg-gradient-to-br from-[#C9A84C]/10 to-transparent p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full border border-[#C9A84C]/20 bg-[#C9A84C]/10 px-2.5 py-1 text-xs font-semibold text-[#E5CA7A]">{card.status==='open'?(card.publiclyListed?'Public challenge':'Link-only challenge'):card.status==='processing'?'Confirming…':'Accepted'}</span>
          <span className="text-xs text-white/55">{card.displayName} · No increment</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-xs text-white/50">Entry Amount</p><p className="mt-1 text-2xl font-bold text-white">${Number(card.entryAmount).toFixed(2)}</p></div>
          <div><p className="text-xs text-white/50">Winner award</p><p className="mt-1 text-2xl font-bold text-[#E5CA7A]">${Number(card.winnerAward).toFixed(2)}</p></div>
        </div>
        <p className="text-xs text-white/55">${Number(card.serviceFee).toFixed(2)} service fee · ${Number(card.totalRequired).toFixed(2)} required per player</p>
        <p className="text-sm leading-relaxed text-white/65">{card.publiclyListed ? 'Your challenge is listed in Find an Opponent. Share the link with a friend, or meet someone new.' : 'Your challenge is link-only. Share it with the person you want to play.'}</p>
        {card.status==='open' && <>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={()=>share(card)} className="h-11 rounded-xl gold-gradient font-bold text-black"><Share2 size={15} className="mr-2"/>Share</Button>
            <Button variant="outline" onClick={()=>cancel(card)} disabled={Boolean(busyId)} className="h-11 rounded-xl border-white/15 text-white/65">{busyId===card.id?'Cancelling…':'Cancel'}</Button>
          </div>
          <p className="text-xs text-white/45">No funds reserved. Both players must qualify before acceptance.</p>
        </>}
        <Link to={`/play?challenge=${card.inviteCode}`} className="block text-xs font-semibold text-[#C9A84C]">{card.status==='open' ? (card.creatorReady ? 'Challenge details & visibility' : 'Review eligibility & enable acceptance') : 'Open Match'}</Link>
      </article>)}</div>}
      {activePublic && <ActiveChallengeCard match={activePublic} onCancel={async()=>{await base44.functions.invoke('cancelMatch',{matchId:activePublic.id});await refresh();}}/>}
    </div>}
    {error && <p role="status" className="text-xs text-[#E5CA7A]">{error}</p>}
    <div className="border-t border-white/10 pt-4">
      <button onClick={()=>setShowPublic(value=>!value)} aria-expanded={showPublic} className="flex w-full items-center justify-between gap-3 text-left"><div><h2 className="font-semibold text-white/80">Find an Opponent</h2><p className="mt-1 text-xs text-white/40">Browse public challenges.</p></div><ChevronDown className={`text-white/40 transition-transform ${showPublic?'rotate-180':''}`} size={18}/></button>
      {showPublic && <div className="mt-4 space-y-4">
        <AvailableMatchSection userId={userId} balance={balance} activeMatch={activePublic} onChallengeCancelled={()=>setActivePublic(null)} onAccepted={onMatchAccepted} onReview={code=>navigate(`/play?challenge=${code}&accept=1`)}/>
      </div>}
    </div>
  </section>;
}
