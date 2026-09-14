import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ChallengeVisibilityToggle from '@/components/play/ChallengeVisibilityToggle';
import { computeContestFinancials } from '@/lib/contestFinancials';
import { challengeRequest, challengeErrorMessage, handleChallengeGate } from '@/lib/challengeApi';

import { CHALLENGE_TIME_CONTROLS, ENTRY_AMOUNTS, validNewEntry, CHALLENGE_CREATION_VERSION } from '../../../base44/shared/challengePolicy.js';

export default function CreateChallengeForm({ initialAmount = 10, initialMode = 'free', initialTimeControl = 'blitz', rematchOf = '', onCreated, onCancel }) {
  const navigate = useNavigate();
  const [playMode,setPlayMode]=useState(initialMode==='money'?'money':'free');
  const free=playMode==='free';
  const [amount, setAmount] = useState(String(validNewEntry(initialAmount) ? Number(initialAmount) : 10));
  const [timeControl, setTimeControl] = useState(CHALLENGE_TIME_CONTROLS.some(tc => tc.value === initialTimeControl) ? initialTimeControl : 'blitz');
  const [publiclyListed, setPubliclyListed] = useState(!rematchOf);
  const {user}=useAuth();
  const client=useQueryClient();
  const {data:funding,isError:fundingError}=useQuery({
    queryKey:['challenge-wallet',user?.id],enabled:!!user?.id,refetchInterval:10000,
    queryFn:()=>challengeRequest('wallet_summary'),
  });
  const playable=Number(funding?.available_to_play || 0);
  const canAfford=value=>!!funding && Math.round(computeContestFinancials(value).totalCharge*100)<=Math.round(playable*100);
  useEffect(()=>{
    if (!funding || canAfford(Number(amount))) return;
    const next=ENTRY_AMOUNTS.find(canAfford);
    setAmount(next===undefined?'':String(next));
  },[funding,amount]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [gate, setGate] = useState('');
  const request = useRef({ terms:'', key:'' });
  const valid = free || (validNewEntry(amount) && canAfford(Number(amount)));
  const financials = free ? {entryAmount:0,serviceFee:0,totalCharge:0,potentialWinnerAward:0} : computeContestFinancials(Number(amount));
  const create = async (event) => {
    event.preventDefault();
    if (busy || !valid) return;
    setBusy(true); setError(''); setGate('');
    const terms = `${playMode}:${free?0:Number(amount)}:${timeControl}:${rematchOf}:${publiclyListed}`;
    if (request.current.terms !== terms) request.current = { terms, key:crypto.randomUUID().replaceAll('-','') };
    try {
      const result = await challengeRequest('create', { playMode, creationVersion:CHALLENGE_CREATION_VERSION, serviceFee:financials.serviceFee, entryAmount:free?0:Number(amount), timeControl, publiclyListed, requestKey:request.current.key, ...(rematchOf ? { rematchOf } : {}) });
      if (!result.path || !/^[a-f0-9]{32}$/.test(result.inviteCode || '')) throw new Error('The invitation was not returned. Please retry this request.');
      await Promise.all([client.invalidateQueries({queryKey:['header-wallet']}),client.invalidateQueries({queryKey:['challenge-wallet']})]);
      if (onCreated) await onCreated(result);
      else navigate('/play');
    } catch (err) {
      if (err?.response?.data?.code==='creation_failed') request.current={terms:'',key:''};
      client.invalidateQueries({queryKey:['challenge-wallet']});
      setGate(err?.response?.data?.action || err?.response?.data?.code || '');
      if (!handleChallengeGate(err,navigate,'/play')) setError(challengeErrorMessage(err));
    } finally { setBusy(false); }
  };
  return <form onSubmit={create} className="space-y-4" aria-label={rematchOf ? 'Create rematch' : 'Create shared challenge'}>
    <div><h3 className="text-lg font-bold text-white">{rematchOf ? 'Run it back' : 'Create a challenge'}</h3>
      <p className="mt-1 text-sm text-white/50">Choose your time control · No increment</p></div>
    <fieldset disabled={busy} className="grid grid-cols-2 gap-2"><legend className="mb-2 text-sm text-white/60">Play for</legend>
      {['free','money'].map(mode=><button key={mode} type="button" aria-pressed={playMode===mode} onClick={()=>{setPlayMode(mode);setError('');setGate('');}} className={`h-11 rounded-xl font-semibold ${playMode===mode?'gold-gradient text-black':'border border-white/10 text-white/60'}`}>{mode==='free'?'Free play':'Money play'}</button>)}
    </fieldset>
    <fieldset disabled={busy}>
      <legend className="mb-2 text-sm text-white/60">Time control</legend>
      <div className="grid grid-cols-3 gap-2">
        {CHALLENGE_TIME_CONTROLS.map(tc => <label key={tc.value} className={`relative cursor-pointer rounded-xl border p-3 text-center focus-within:ring-2 focus-within:ring-[#C9A84C] ${timeControl === tc.value ? 'border-[#C9A84C] bg-[#C9A84C]/10 text-[#E5CA7A]' : 'border-white/10 bg-white/5 text-white/65'}`}>
          <input type="radio" name="timeControl" value={tc.value} checked={timeControl === tc.value} onChange={() => setTimeControl(tc.value)} className="sr-only" />
          <span className="block text-sm font-semibold">{tc.label}</span>
          <span className="mt-1 block text-xs">{tc.minutes} min</span>
        </label>)}
      </div>
    </fieldset>
    {!free && <fieldset disabled={busy}>
      <legend className="mb-2 text-sm text-white/60">Entry Amount</legend>
      <div className="grid grid-cols-3 gap-2">
        {ENTRY_AMOUNTS.map(value => <button type="button" key={value} disabled={busy || !canAfford(value)}
          aria-pressed={Number(amount) === value} onClick={() => setAmount(String(value))}
          className={`h-11 rounded-xl font-semibold disabled:cursor-not-allowed disabled:opacity-30 ${Number(amount) === value ? 'gold-gradient text-black' : 'border border-white/10 bg-white/5 text-white hover:border-[#C9A84C]/50'}`}>${value.toLocaleString('en-US')}</button>)}
      </div>
    </fieldset>}
    {!free && valid && financials.serviceFee !== null && <dl className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
      <div className="flex justify-between gap-4"><dt className="text-white/55">Entry Amount</dt><dd className="text-white">${financials.entryAmount.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-white/55">Platform Service Fee</dt><dd className="text-white">${financials.serviceFee.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-4 border-t border-white/10 pt-2 font-semibold"><dt className="text-white/75">Reserved when created</dt><dd className="text-white">${financials.totalCharge.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-white/55">Winner award</dt><dd className="font-bold text-[#C9A84C]">${financials.potentialWinnerAward.toFixed(2)}</dd></div>
    </dl>}
    {free && <p className="text-xs leading-relaxed text-white/50">Play chess worldwide. Challenge a friend or meet a new opponent. Completed games count toward your rating.</p>}
    {!free && <p className="text-xs text-white/50">{fundingError?'Balance unavailable. Please retry shortly.':!funding?'Checking your playable balance…':`Playable balance: $${playable.toFixed(2)}`}</p>}
    {!free && funding && !ENTRY_AMOUNTS.some(canAfford) && <Button type="button" variant="outline" onClick={()=>navigate('/wallet')} className="w-full rounded-xl">Add funds to play for money</Button>}
    <ChallengeVisibilityToggle checked={publiclyListed} onChange={setPubliclyListed} disabled={busy} rematch={Boolean(rematchOf)} />
    {rematchOf && <p className="text-xs text-[#C9A84C]">This rematch link is for your previous opponent. Share it with them after creation.</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {!free && gate==='location_required' && <Button type="button" onClick={()=>{setPlayMode('free');setError('');setGate('');}} className="w-full rounded-xl gold-gradient text-black">Make this a free match</Button>}
    {['funds_required','identity_required','bank_required'].includes(gate) && <Button type="button" variant="outline" onClick={()=>navigate('/wallet')} className="w-full rounded-xl border-[#C9A84C]/30 text-[#E5CA7A]">{gate==='funds_required'?'Fund Wallet':'Complete Wallet Setup'}</Button>}
    <Button type="submit" disabled={busy || !valid} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black disabled:opacity-40">
      {busy ? <Loader2 size={17} className="mr-2 animate-spin" /> : <ArrowRight size={17} className="mr-2" />}
      {busy ? (free?'Creating free challenge…':'Checking eligibility…') : rematchOf ? 'Create Rematch Link' : 'Create Challenge Link'}
    </Button>
    {onCancel && <button type="button" onClick={onCancel} disabled={busy} className="w-full py-2 text-sm text-white/50">Back</button>}
  </form>;
}