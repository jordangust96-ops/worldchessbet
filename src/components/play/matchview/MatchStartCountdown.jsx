import React, { useState, useEffect, useRef } from 'react';
import { Crown } from 'lucide-react';
import { base44 } from '@/api/base44Client';

// Display the remaining server-scheduled lead-in, never a new local countdown.
export default function MatchStartCountdown({ game, onDone }) {
  const [count,setCount]=useState(null);
  const [error,setError]=useState(false);
  const done=useRef(onDone);done.current=onDone;
  useEffect(()=>{
    if(!game?.id)return;
    if(game.move_log?.length || game.pgn){done.current();return;}
    let active=true, sample=null, pending=false;
    const sync=async()=>{
      if(pending || sample)return;pending=true;
      const sent=performance.now();
      try{
        const {data}=await base44.functions.invoke('getGameClock',{gameId:game.id});
        if(!active)return;
        const received=performance.now();
        const start=Date.parse(data.turn_started_at || '');
        if(!Number.isFinite(start) || !Number.isFinite(data.server_now_ms))throw Error('clock_unavailable');
        sample={start,serverNow:data.server_now_ms+(received-sent)/2,received};setError(false);tick();
      }catch{if(active)setError(true);}finally{pending=false;}
    };
    const tick=()=>{
      if(!active || !sample)return;
      const left=Math.max(0,sample.start-sample.serverNow-(performance.now()-sample.received));
      if(left===0){done.current();return;}setCount(Math.ceil(left/1000));
    };
    sync();const timer=setInterval(()=>{if(sample)tick();else sync();},250);
    return()=>{active=false;clearInterval(timer);};
  },[game?.id]);
  return <div className="flex flex-col items-center justify-center gap-4 py-16">
    <Crown size={22} className="text-[#C9A84C]"/>
    <p className="text-[10px] uppercase tracking-widest text-white/40">{count===null ? (error?'Reconnecting to game clock…':'Loading your game…') : 'Both Players Ready'}</p>
    {count!==null && <p className="text-6xl font-extrabold gold-text tabular-nums">{count}</p>}
  </div>;
}
