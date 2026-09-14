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
  const openInHud = code => { setCreating(false); navigate(`/play?challenge=${code}`); };
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
  return <section className="space-y-5 rounded-3xl border border-white/5 bg-gradient-to-br from-[#1A1A1A] to-[#111] p-5 lg:h-full lg:overflow-y-auto lg:p-5">
    {selectedCode ? <ChallengePanel key={selectedCode} inviteCode={selectedCode} embedded onClose={()=>navigate("/play")} onChanged={refresh}/> : loading ? <Loader2 aria-label="Loading your challenge" size={20} className="animate-spin text-white/40"/> : creating && !creationBlocked ? <CreateChallengeForm onCreated={async result=>{ openInHud(result.inviteCode); await refresh(); }} onCancel={()=>setCreating(false)}/> : !creationBlocked ? <div className="space-y-3">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#C9A84C]/10 text-[#C9A84C]"><Swords size={21}/></div>
      <div><h1 className="text-2xl font-extrabold text-white">Challenge Someone</h1><p className="mt-2 text-sm leading-relaxed text-white/55">Your friend. Your rival. Your next opponent. Create a link and play chess for money.</p></div>
      <Button disabled={creationBlocked} onClick={()=>setCreating(true)} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black"><Plus size={18} className="mr-2"/>Create Challenge</Button>
      <p className="text-xs leading-relaxed text-white/40">Links reserve no money or opponent. Both players need available funds when the challenge is accepted.</p>
    </div> : null}
    {!selectedCode && !loading && (challenges.length > 0 || activePublic) && <div className="border-t border-white/10 pt-4">
      <h2 className="mb-3 text-sm font-semibold text-white/75">Your pending challenge</h2>
      {loading ? <Loader2 size={18} className="animate-spin text-white/40"/> : challenges.length ? <div className="space-y-2">{challenges.map(card=><article key={card.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
        <div className="flex items-center justify-between gap-3"><Link to={`/play?challenge=${card.inviteCode}`} className="font-semibold text-white">${Number(card.entryAmount).toFixed(2)} · {card.displayName}</Link><span className="text-xs text-[#C9A84C]">{card.status==='open'?(card.publiclyListed?'Public challenge':'Link-only challenge'):card.status==='processing'?'Confirming…':'Accepted'}</span></div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs"><Link to={`/play?challenge=${card.inviteCode}`} className="font-semibold text-[#C9A84C]">{card.status==='open'?'Open Challenge':'Open Match'}</Link>
          {card.status==='open' && <><button onClick={()=>share(card)} className="inline-flex items-center gap-1 text-white/55"><Share2 size={13}/>Share</button><button onClick={()=>cancel(card)} disabled={Boolean(busyId)} className="text-white/40">{busyId===card.id?'Cancelling…':'Cancel'}</button></>}
        </div>
      </article>)}</div> : <p className="text-sm text-white/35">Your challenge will appear here. You can have one open challenge at a time.</p>}
      {activePublic && <ActiveChallengeCard match={activePublic} onCancel={async()=>{await base44.functions.invoke('cancelMatch',{matchId:activePublic.id});await refresh();}}/>}
    </div>}
    {error && <p role="status" className="text-xs text-[#E5CA7A]">{error}</p>}
    <div className="border-t border-white/10 pt-4">
      <button onClick={()=>setShowPublic(value=>!value)} aria-expanded={showPublic} className="flex w-full items-center justify-between gap-3 text-left"><div><h2 className="font-semibold text-white/80">Find an Opponent</h2><p className="mt-1 text-xs text-white/40">Browse public challenges.</p></div><ChevronDown className={`text-white/40 transition-transform ${showPublic?'rotate-180':''}`} size={18}/></button>
      {showPublic && <div className="mt-4 space-y-4">
        <AvailableMatchSection userId={userId} balance={balance} activeMatch={activePublic} onChallengeCancelled={()=>setActivePublic(null)} onAccepted={onMatchAccepted} onReview={code=>navigate(`/play?challenge=${code}&accept=1`)}/>
        <div className="h-px bg-white/10"/>

      </div>}
    </div>
  </section>;
}
