import NotifyOnAcceptToggle from '@/components/play/NotifyOnAcceptToggle';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Share2, Swords, Plus, Loader2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { challengeRequest, challengeErrorMessage } from '@/lib/challengeApi';
import ChallengeAvailability from '@/components/play/ChallengeAvailability';
import ChallengePanel from '@/components/play/ChallengePanel';
import CreateChallengeForm from '@/components/play/CreateChallengeForm';
import AvailableMatchSection from '@/components/play/AvailableMatchSection';
import ActiveChallengeCard from '@/components/play/ActiveChallengeCard';
import LiveStatsBar from '@/components/play/LiveStatsBar';

export default function ChallengeHub({ userId, balance, onMatchAccepted }) {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedCode = new URLSearchParams(location.search).get("challenge");
  const selectedCode = /^[a-f0-9]{32}$/.test(requestedCode || "") ? requestedCode : "";
  const [creating,setCreating] = useState(false);
  const [challenges,setChallenges] = useState([]);
  const [activePublic,setActivePublic] = useState(null);
  const [loading,setLoading] = useState(true);
  const [loadFailed,setLoadFailed] = useState(false);
  const [error,setError] = useState('');
  const [busyId,setBusyId] = useState('');
  const [copiedId,setCopiedId] = useState('');
  // Ignore superseded reads and remember only server-confirmed cancellations.
  const reads = useRef({ generation:0, retry:null, closed:new Set(), hasSnapshot:false });
  const [refreshError,setRefreshError] = useState('');
  const refresh = useCallback(async(attempt=0)=>{
    if(!userId)return;
    const state=reads.current;
    const generation=++state.generation;
    clearTimeout(state.retry);
    try{
      const [data,publicRows]=await Promise.all([
        challengeRequest('list'),
        base44.entities.Match.filter({launch_epoch:2,player1_id:userId,status:'searching',is_private:{$ne:true}},'-created_date',5),
      ]);
      if(generation!==state.generation)return;
      setChallenges((data.challenges || []).filter(card=>!state.closed.has(card.id)));
      setActivePublic(publicRows.find(row=>!state.closed.has(row.id)) || null);
      state.hasSnapshot=true;setRefreshError('');setLoadFailed(false);setLoading(false);
    }catch(err){
      if(generation!==state.generation)return;
      const status=err?.response?.status;
      const transient=!status || status===429 || status>=500;
      if(transient && attempt<2){
        state.retry=setTimeout(()=>refresh(attempt+1),500*(attempt+1));
        return;
      }
      // A background read failure must not erase the last confirmed screen.
      setLoadFailed(!state.hasSnapshot);
      setRefreshError(transient?'Unable to refresh your challenges. Please try again.':challengeErrorMessage(err));
      setLoading(false);
    }
  },[userId]);
  useEffect(()=>{
    reads.current={generation:reads.current.generation+1,retry:null,closed:new Set(),hasSnapshot:false};
    setChallenges([]);setActivePublic(null);setLoading(true);setLoadFailed(false);setRefreshError('');
    refresh();
    if(!userId)return;
    let eventTimer;
    const unsubscribe=base44.entities.Match.subscribe(event=>{
      if(event.data?.launch_epoch===2 && event.data?.player1_id===userId){
        clearTimeout(eventTimer);eventTimer=setTimeout(()=>refresh(),150);
      }
    });
    const visible=()=>{if(document.visibilityState==='visible')refresh();};
    const timer=setInterval(visible,20000);
    window.addEventListener('focus',visible);
    return()=>{
      reads.current.generation++;clearTimeout(reads.current.retry);clearTimeout(eventTimer);
      unsubscribe();clearInterval(timer);window.removeEventListener('focus',visible);
    };
  },[userId,refresh]);
  const cancel=async card=>{
    setBusyId(card.id);setError('');
    try{
      const result=await challengeRequest('cancel',{matchId:card.id});
      if(result?.match?.status==='cancelled' && !result.processing){
        reads.current.generation++;
        reads.current.closed.add(card.id);
        setChallenges(rows=>rows.filter(row=>row.id!==card.id));
        setActivePublic(row=>row?.id===card.id?null:row);
        setRefreshError('');setCreating(false);
      }
      await refresh();
    }catch(err){setError(challengeErrorMessage(err));}finally{setBusyId('');}
  };
  const shareText=card=>card.playMode==='free'
    ? 'Think you can beat me? Join my free ChessBet challenge.'
    : `Think you can beat me? Join my $${Number(card.entryAmount).toFixed(2)} ChessBet challenge. Entry plus a separate service fee; eligibility and available funds are required.`;
  const copyUrl=async card=>{
    const url=`${window.location.origin}${card.path}`;
    try{
      await navigator.clipboard.writeText(url);
      setCopiedId(card.id); setError('');
      window.setTimeout(()=>setCopiedId(current=>current===card.id?'':current),1800);
    }catch{
      setError('Copy was unavailable. Open the challenge to select the URL directly.');
    }
  };
  const share=async card=>{
    const url=`${window.location.origin}${card.path}`;
    try{
      if(navigator.share) await navigator.share({title:'ChessBet Challenge',text:shareText(card),url});
      else await copyUrl(card);
    }catch(err){if(err?.name!=='AbortError')setError('Open the challenge to copy its link.');}
  };
  const existingChallenge = challenges.find(card => ['open','processing','claimed'].includes(card.status));
  const creationBlocked = loading || loadFailed || Boolean(activePublic) || Boolean(existingChallenge);

  return <section className="space-y-5 rounded-3xl border border-white/5 bg-gradient-to-br from-[#1A1A1A] to-[#111] p-5 lg:h-full lg:overflow-y-auto lg:p-5">
    {userId && <LiveStatsBar />}
    {selectedCode ? <ChallengePanel key={selectedCode} inviteCode={selectedCode} embedded onClose={()=>navigate("/play")} onChanged={refresh}/> : loading ? <Loader2 aria-label="Loading your challenge" size={20} className="animate-spin text-white/40"/> : creating && !creationBlocked ? <CreateChallengeForm onCreated={async()=>{ await refresh(); setCreating(false); navigate('/play', { replace:true }); }} onCancel={()=>setCreating(false)}/> : !creationBlocked ? <div className="space-y-3">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#C9A84C]/10 text-[#C9A84C]"><Swords size={21}/></div>
      <div><h1 className="text-2xl font-extrabold text-white">Challenge Someone</h1><p className="mt-2 text-sm leading-relaxed text-white/55">Your friend. Your rival. Your next opponent. Create a link and play chess for free or for money.</p></div>
      <Button disabled={creationBlocked} onClick={()=>setCreating(true)} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black"><Plus size={18} className="mr-2"/>Create Challenge</Button>
      <p className="text-xs leading-relaxed text-white/40">Free play is open worldwide. Money play requires verified eligibility, approved location, and cleared funds.</p>
    </div> : null}
    {!selectedCode && !loading && (challenges.length > 0 || activePublic) && <div className="border-t border-white/10 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#C9A84C]/25 bg-[#C9A84C]/10 text-[#E5CA7A]"><Swords size={23}/></div>
        <div><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[#C9A84C]">Challenge posted</p>
          <h2 className="text-xl font-extrabold leading-tight text-white">Your next match starts here</h2></div>
      </div>
      {challenges.length > 0 && <div className="space-y-3">{challenges.map(card=><article key={card.id} className="space-y-3 rounded-2xl border border-[#C9A84C]/20 bg-gradient-to-br from-[#C9A84C]/10 to-transparent p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full border border-[#C9A84C]/20 bg-[#C9A84C]/10 px-2.5 py-1 text-xs font-semibold text-[#E5CA7A]">{card.status==='open'?'Waiting for an opponent':card.status==='processing'?'Pending':card.status==='claimed'?'Accepted':card.status==='expired'?'Expired':'Closed'}</span>
          <span className="text-xs text-white/55">{card.displayName} · No increment</span>
        </div>
        {card.playMode==='free' ? <p className="text-xl font-bold text-[#E5CA7A]">Free play</p> : <><div className="grid grid-cols-2 gap-3">
          <div><p className="text-xs text-white/50">Entry Amount</p><p className="mt-1 text-2xl font-bold text-white">${Number(card.entryAmount).toFixed(2)}</p></div>
          <div><p className="text-xs text-white/50">Winner award</p><p className="mt-1 text-2xl font-bold text-[#E5CA7A]">${Number(card.winnerAward).toFixed(2)}</p></div>
        </div></>}
        <p className="text-sm leading-relaxed text-white/65">{card.status==='processing' ? 'Share your challenge link while it gets ready.' : card.publiclyListed ? 'Your challenge is listed publicly. Share the link with a friend, or wait for someone new to accept.' : 'Your challenge is link-only. Share it with the person you want to play.'}</p>
        {['open','processing'].includes(card.status) && <>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={()=>share(card)} className="h-11 rounded-xl gold-gradient font-bold text-black"><Share2 size={15} className="mr-2"/>Share</Button>
            <Button variant="outline" onClick={()=>cancel(card)} disabled={Boolean(busyId)} className="h-11 rounded-xl border-white/15 text-white/65">{busyId===card.id?'Cancelling…':'Cancel'}</Button>
          </div>
          <button onClick={()=>copyUrl(card)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-left transition hover:border-[#C9A84C]/30" aria-label="Copy challenge URL only">
            <span className="min-w-0 truncate text-xs text-white/55">{`${window.location.origin}${card.path}`}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#E5CA7A]">{copiedId===card.id?<><Check size={14}/>Copied</>:<><Copy size={14}/>Copy URL</>}</span>
          </button>
          {card.playMode!=='free' && card.creatorFundsReserved && <p className="text-xs text-white/45">${Number(card.totalRequired).toFixed(2)} reserved for this match.</p>}
          <NotifyOnAcceptToggle match={{id:card.id,notify_on_accept:card.notifyOnAccept}} onChanged={refresh} />
        </>}
        {card.status==='open' && card.playMode!=='free' && !card.creatorFundsReserved && <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-sm leading-relaxed text-white/65">To play this match, you need ${Number(card.totalRequired).toFixed(2)} in available wallet funds, including the service fee. Pending deposits cannot be used yet.</p>
          <Button asChild variant="outline" className="h-11 w-full rounded-xl border-[#C9A84C]/30 font-semibold text-[#E5CA7A]"><Link to={`/wallet?challenge=${card.inviteCode}`}>Fund Wallet</Link></Button>
        </div>}
        {card.status==='open' && card.creatorPresenceRequired !== false && <ChallengeAvailability card={card} onChanged={refresh}/>}
      </article>)}</div>}
      {activePublic && <ActiveChallengeCard match={activePublic} onCancel={async()=>{await base44.functions.invoke('cancelMatch',{matchId:activePublic.id});await refresh();}}/>}
    </div>}
    {refreshError && <div role="status" className="text-xs text-white/60">{refreshError} <button type="button" className="ml-2 underline text-[#E5CA7A]" onClick={()=>refresh()}>Retry</button></div>}
    {error && <p role="status" className="text-xs text-[#E5CA7A]">{error}</p>}
    <div className="border-t border-white/10 pt-4">
      <h2 className="font-semibold text-white/80">Find an Opponent</h2><p className="mt-1 text-xs text-white/40">Browse public challenges.</p>
      <div className="mt-4 space-y-4">
        <AvailableMatchSection userId={userId} balance={balance} activeMatch={activePublic} onChallengeCancelled={()=>setActivePublic(null)} onAccepted={onMatchAccepted} onReview={code=>navigate(`/play?challenge=${code}&accept=1`)}/>
      </div>
    </div>
  </section>;
}