import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { challengeRequest, readChallengeContext, saveChallengeContext, VALID_INVITE, CHALLENGE_NOT_RESERVED } from '@/lib/challengeApi';

export default function ChallengeFundingContext({ userId, availableBalance = 0 }) {
  const location = useLocation();
  const [code,setCode] = useState(null);
  const [challenge,setChallenge] = useState(null);
  useEffect(()=>{
    if(!userId)return;
    const requested=new URLSearchParams(location.search).get('challenge');
    if(VALID_INVITE.test(requested || '')) {saveChallengeContext(userId,requested);setCode(requested);return;}
    const saved=readChallengeContext(userId);
    if(saved){setCode(saved);return;}
    let active=true;
    challengeRequest('intent').then(data=>{
      if(active && VALID_INVITE.test(data.intent?.inviteCode || ''))setCode(data.intent.inviteCode);
    }).catch(()=>{});
    return()=>{active=false;};
  },[userId,location.search]);
  useEffect(()=>{
    if(!code)return;
    let active=true;
    const read=()=>challengeRequest('view',{inviteCode:code}).then(data=>{if(active)setChallenge(data.challenge);}).catch(()=>{});
    read();window.addEventListener('focus',read);
    return()=>{active=false;window.removeEventListener('focus',read);};
  },[code,availableBalance]);
  if(!challenge)return null;
  const enough=Number(availableBalance)>=Number(challenge.totalRequired);
  const open=challenge.status==='open';
  return <section className="rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/5 p-4">
    <h2 className="text-sm font-bold text-white">{enough ? 'Your available balance covers this entry' : 'Fund your wallet, keep your options open'}</h2>
    <p className="mt-2 text-sm text-white/60">{open ? `${challenge.creatorName}’s $${Number(challenge.entryAmount).toFixed(2)} challenge is still open.` : 'The challenge you viewed is no longer open. Your wallet setup still counts for future matches.'}</p>
    <p className="mt-2 text-xs leading-relaxed text-white/45">{CHALLENGE_NOT_RESERVED}</p>
    <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold"><Link to={`/challenge/${code}`} className="text-[#C9A84C]">{open ? 'Return to Challenge' : 'View Challenge'}</Link><Link to="/play" className="text-white/55">Create Your Own</Link></div>
  </section>;
}
