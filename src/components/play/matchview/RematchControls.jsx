import React, {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {challengeRequest, challengeErrorMessage, challengeLocationContext} from '@/lib/challengeApi';

const RematchControls=forwardRef(function RematchControls({match,opponentName,onAccepted},ref) {
  const [view,setView]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
  const [playable,setPlayable]=useState(null);
  const screen=useRef(crypto.randomUUID()),active=useRef(false),action=useRef(false),revision=useRef(0);
  const accepted=useRef(false),onAcceptedRef=useRef(onAccepted),lastSuccess=useRef(0),pending=useRef(null);
  onAcceptedRef.current=onAccepted;
  const call=(name,body={})=>challengeRequest(name,{matchId:match.id,screenId:screen.current,...body});
  const apply=data=>{
    if(!active.current)return;
    lastSuccess.current=Date.now();setView(data);
    if(data.offer?.status==='accepted' && data.offer.matchId && !accepted.current){
      accepted.current=true;onAcceptedRef.current?.(data.offer.matchId);
    }
  };
  const leave=async()=>{
    active.current=false;
    // Wait for an explicit request/accept to resolve before leaving; a lost
    // response is still bounded by the server presence and offer deadlines.
    if(pending.current)await pending.current.catch(()=>{});
    await call('rematch_leave').catch(()=>{});
  };
  useImperativeHandle(ref,()=>({leave}));
  useEffect(()=>{
    // Each mounted results screen owns a distinct token. Cleanup from an old
    // mount cannot withdraw the new screen's presence.
    const token=crypto.randomUUID();
    screen.current=token;active.current=true;accepted.current=false;lastSuccess.current=0;
    setView(null);setError('');
    let stopped=false,registered=false,running=false;
    const sessionCall=name=>challengeRequest(name,{matchId:match.id,screenId:token});
    const update=async()=>{
      if(stopped || !active.current || running || document.visibilityState!=='visible')return;
      running=true;
      const requestRevision=revision.current;
      try{
        const data=await sessionCall(registered?'rematch_poll':'rematch_enter');
        if(stopped || !active.current || screen.current!==token)return;
        // Retry registration until the server confirms this screen. A failed
        // Enter must not leave us polling an unregistered token forever.
        registered=Boolean(data.selfPresent);
        lastSuccess.current=Date.now();
        if(!action.current && requestRevision===revision.current){apply(data);setError('');}
      }catch(err){
        if(!stopped && active.current && !lastSuccess.current)
          setError('Reconnecting to the rematch…');
      }finally{running=false;}
    };
    update();
    const poll=setInterval(update,4000),clock=setInterval(()=>setNow(Date.now()),1000);
    const exit=()=>{active.current=false;void sessionCall('rematch_leave').catch(()=>{});};
    window.addEventListener('pagehide',exit);
    window.addEventListener('online',update);
    const visible=()=>{if(document.visibilityState==='visible')update();};
    document.addEventListener('visibilitychange',visible);
    return()=>{
      stopped=true;active.current=false;clearInterval(poll);clearInterval(clock);
      window.removeEventListener('pagehide',exit);window.removeEventListener('online',update);
      document.removeEventListener('visibilitychange',visible);
      void sessionCall('rematch_leave').catch(()=>{});
    };
  },[match.id]);
  useEffect(()=>{
    if(view?.terms?.playMode!=='money')return;
    let stopped=false,running=false;
    const refresh=async()=>{if(running || document.visibilityState!=='visible')return;running=true;
      try{const summary=await challengeRequest('wallet_summary');if(!stopped)setPlayable(Number(summary.available_to_play));}
      catch{if(!stopped)setPlayable(null);}finally{running=false;}};
    refresh();const timer=setInterval(refresh,10000);
    return()=>{stopped=true;clearInterval(timer);};
  },[view?.terms?.playMode,view?.offer?.status]);
  const run=async name=>{
    if(action.current || !active.current)return;
    action.current=true;revision.current++;setBusy(name);setError('');
    const work=(async()=>{
      try{
        const terms=view?.terms || {};
        const offer=view?.offer;
        const location=name==='rematch_accept' && terms.playMode==='money'?await challengeLocationContext():{};
        const data=await call(name,{...location,entryAmount:offer?.status==='pending'?offer.entryAmount:terms.entryAmount,
          serviceFee:offer?.status==='pending'?offer.serviceFee:terms.serviceFee,
          offerId:offer?.id,requestKey:crypto.randomUUID().replaceAll('-',''),agree:true});
        apply(data);
      }catch(err){if(active.current)setError(challengeErrorMessage(err));}
      finally{action.current=false;if(active.current)setBusy('');}
    })();
    pending.current=work;await work;pending.current=null;
  };
  const offer=view?.offer,free=view?.terms?.playMode==='free';
  const fresh=lastSuccess.current>now-15000;
  const present=fresh && view?.selfPresent && view?.opponentPresent;
  const open=offer?.status==='pending' && Date.parse(offer.expiresAt)>now;
  const declined=offer?.status==='declined';
  const seconds=Math.max(0,Math.ceil((Date.parse(offer?.expiresAt||'')-now)/1000));
  const total=Number(view?.terms?.entryAmount||0)+Number(view?.terms?.serviceFee||0);
  const canAfford=free || (Number.isFinite(playable) && Math.round(playable*100)>=Math.round(total*100));
  const money=value=>Number(value||0).toFixed(2);
  return <section aria-label="Rematch" className="space-y-2 rounded-2xl border border-white/10 p-3">
    <p className="text-sm font-semibold text-white">Rematch {opponentName}</p>
    {view && <p className="text-xs text-white/55">{free?'Free play':`Entry Amount $${money(view.terms.entryAmount)} · Platform Service Fee $${money(view.terms.serviceFee)}`} · Same time control</p>}
    {view && !free && <p className="text-xs text-white/55">${money(Number(view.terms.entryAmount)+Number(view.terms.serviceFee))} reserved when you request or accept.</p>}
    <div role="status" aria-live="polite" className="text-sm text-white/65">
      {!view?'Connecting to the rematch…':declined?(offer.incoming?'You declined the rematch.':`${opponentName} declined the rematch.`):
       !fresh || !view.selfPresent?'Reconnecting to the rematch…':busy || offer?.status==='processing'?'Confirming rematch…':
       offer?.status==='accepted'?'Rematch accepted. Opening match…':
       !view.opponentPresent?'Waiting for your opponent to connect on the result screen…':
       open?(offer.incoming?`${opponentName} wants a rematch.`:'Rematch requested. Waiting for your opponent…'):
       offer?.status==='closed'?'Rematch offer closed.':'Your opponent is here.'}
    </div>
    {open && present && <p className="text-xs text-white/45" aria-label="Rematch offer time remaining">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')} to respond</p>}
    {open && offer.incoming ? <div className="flex gap-2">
      <Button disabled={!!busy || !present || !canAfford} onClick={()=>run('rematch_accept')} className="flex-1 rounded-xl gold-gradient text-black">{busy==='rematch_accept'?'Accepting…':'Accept Rematch'}</Button>
      <Button disabled={!!busy} onClick={()=>run('rematch_decline')} variant="outline" className="flex-1 rounded-xl">Decline</Button>
    </div>:open ? <Button disabled={!!busy} onClick={()=>run('rematch_cancel')} variant="outline" className="w-full rounded-xl">Cancel Rematch Request</Button>:
    <Button disabled={!!busy || declined || !present || !canAfford || ['accepted','processing'].includes(offer?.status)} onClick={()=>run('rematch_request')} className="w-full h-12 rounded-2xl font-bold gold-gradient text-black">{declined?'Rematch Declined':busy==='rematch_request'?'Requesting…':'Request Rematch'}</Button>}
    {view && !free && !declined && !canAfford && (!open || offer.incoming) && <p className="text-xs text-white/55">{playable===null?'Checking playable balance…':`You need $${money(total)} in playable funds to rematch.`}</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </section>;
});
export default RematchControls;
