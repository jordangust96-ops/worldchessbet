import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MoneyPlayLocation from '@/components/play/MoneyPlayLocation';
import ChallengeVisibilityToggle from '@/components/play/ChallengeVisibilityToggle';
import { computeContestFinancials } from '@/lib/contestFinancials';
import { challengeRequest, challengeErrorMessage, handleChallengeGate } from '@/lib/challengeApi';

import { CHALLENGE_TIME_CONTROLS, ENTRY_AMOUNTS, validNewEntry, CHALLENGE_HUD_TERMS, CHALLENGE_HUD_CONSENT_VERSION, FREE_PLAY_TERMS } from '../../../base44/shared/challengePolicy.js';

export default function CreateChallengeForm({ initialAmount = 10, initialMode = 'free', initialTimeControl = 'blitz', rematchOf = '', onCreated, onCancel }) {
  const navigate = useNavigate();
  const [playMode,setPlayMode]=useState(initialMode==='money'?'money':'free');
  const free=playMode==='free';
  const [amount, setAmount] = useState(String(validNewEntry(initialAmount) ? Number(initialAmount) : 10));
  const [timeControl, setTimeControl] = useState(CHALLENGE_TIME_CONTROLS.some(tc => tc.value === initialTimeControl) ? initialTimeControl : 'blitz');
  const [publiclyListed, setPubliclyListed] = useState(!rematchOf);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [gate, setGate] = useState('');
  const request = useRef({ terms:'', key:'' });
  const valid = free || validNewEntry(amount);
  const financials = free ? {entryAmount:0,serviceFee:0,totalCharge:0,potentialWinnerAward:0} : computeContestFinancials(Number(amount));
  const create = async (event) => {
    event.preventDefault();
    if (busy || !valid || !agree) return;
    setBusy(true); setError(''); setGate('');
    const terms = `${playMode}:${free?0:Number(amount)}:${timeControl}:${rematchOf}:${publiclyListed}`;
    if (request.current.terms !== terms) request.current = { terms, key:crypto.randomUUID().replaceAll('-','') };
    try {
      const result = await challengeRequest('create', { playMode, agree, consentVersion:CHALLENGE_HUD_CONSENT_VERSION, serviceFee:financials.serviceFee, entryAmount:free?0:Number(amount), timeControl, publiclyListed, requestKey:request.current.key, ...(rematchOf ? { rematchOf } : {}) });
      if (!result.path || !/^[a-f0-9]{32}$/.test(result.inviteCode || '')) throw new Error('The invitation was not returned. Please retry this request.');
      if (onCreated) await onCreated(result);
      else navigate('/play');
    } catch (err) {
      setGate(err?.response?.data?.action || err?.response?.data?.code || '');
      if (!handleChallengeGate(err,navigate,'/play')) setError(challengeErrorMessage(err));
    } finally { setBusy(false); }
  };
  return <form onSubmit={create} className="space-y-4" aria-label={rematchOf ? 'Create rematch' : 'Create shared challenge'}>
    <div><h3 className="text-lg font-bold text-white">{rematchOf ? 'Run it back' : 'Create a challenge'}</h3>
      <p className="mt-1 text-sm text-white/50">Choose your time control · No increment</p></div>
    <fieldset disabled={busy} className="grid grid-cols-2 gap-2"><legend className="mb-2 text-sm text-white/60">Play for</legend>
      {['free','money'].map(mode=><button key={mode} type="button" aria-pressed={playMode===mode} onClick={()=>{setPlayMode(mode);setAgree(false);setError('');setGate('');}} className={`h-11 rounded-xl font-semibold ${playMode===mode?'gold-gradient text-black':'border border-white/10 text-white/60'}`}>{mode==='free'?'Free play':'Money play'}</button>)}
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
        {ENTRY_AMOUNTS.map(value => <button type="button" key={value} disabled={busy}
          aria-pressed={Number(amount) === value} onClick={() => setAmount(String(value))}
          className={`h-11 rounded-xl font-semibold ${Number(amount) === value ? 'gold-gradient text-black' : 'border border-white/10 bg-white/5 text-white hover:border-[#C9A84C]/50'}`}>${value.toLocaleString('en-US')}</button>)}
      </div>
    </fieldset>}
    {!free && valid && financials.serviceFee !== null && <dl className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
      <div className="flex justify-between gap-4"><dt className="text-white/55">Entry Amount</dt><dd className="text-white">${financials.entryAmount.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-white/55">Platform Service Fee</dt><dd className="text-white">${financials.serviceFee.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-4 border-t border-white/10 pt-2 font-semibold"><dt className="text-white/75">Required per player</dt><dd className="text-white">${financials.totalCharge.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-white/55">Winner award</dt><dd className="font-bold text-[#C9A84C]">${financials.potentialWinnerAward.toFixed(2)}</dd></div>
    </dl>}
    <p className="text-xs leading-relaxed text-white/50">{free?'Play worldwide for free. No wallet, identity verification, or money-play location approval required. No charges or money awards.':'Before creating a money challenge, you must pass eligibility and current location checks and have enough cleared, available funds for the entry and fee. Pending deposits do not count. Creating the link reserves no money.'}</p>
    {!free && <MoneyPlayLocation/>}
    <ChallengeVisibilityToggle checked={publiclyListed} onChange={setPubliclyListed} disabled={busy} rematch={Boolean(rematchOf)} />
    {rematchOf && <p className="text-xs text-[#C9A84C]">This rematch link is for your previous opponent. Share it with them after creation.</p>}
    <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-xs leading-relaxed text-white/60"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} className="mt-1"/><span>{free?FREE_PLAY_TERMS:CHALLENGE_HUD_TERMS}</span></label>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {!free && error && <button type="button" onClick={()=>{setPlayMode('free');setAgree(false);setError('');setGate('');}} className="w-full py-2 font-semibold text-[#E5CA7A]">Play for Free Instead</button>}
    {['funds_required','identity_required','bank_required'].includes(gate) && <Button type="button" variant="outline" onClick={()=>navigate('/wallet')} className="w-full rounded-xl border-[#C9A84C]/30 text-[#E5CA7A]">{gate==='funds_required'?'Fund Wallet':'Complete Wallet Setup'}</Button>}
    <Button type="submit" disabled={busy || !valid || !agree} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black disabled:opacity-40">
      {busy ? <Loader2 size={17} className="mr-2 animate-spin" /> : <ArrowRight size={17} className="mr-2" />}
      {busy ? (free?'Creating free challenge…':'Checking eligibility…') : rematchOf ? 'Create Rematch Link' : 'Create Challenge Link'}
    </Button>
    {onCancel && <button type="button" onClick={onCancel} disabled={busy} className="w-full py-2 text-sm text-white/50">Back</button>}
  </form>;
}
