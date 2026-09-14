import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { computeContestFinancials } from '@/lib/contestFinancials';
import { challengeRequest, challengeErrorMessage, handleChallengeGate, validEntry } from '@/lib/challengeApi';

import { CHALLENGE_TIME_CONTROLS } from '../../../base44/shared/challengePolicy.js';

export default function CreateChallengeForm({ initialAmount = 10, initialTimeControl = 'blitz', rematchOf = '', onCreated, onCancel }) {
  const navigate = useNavigate();
  const [amount, setAmount] = useState(String(initialAmount));
  const [timeControl, setTimeControl] = useState(CHALLENGE_TIME_CONTROLS.some(tc => tc.value === initialTimeControl) ? initialTimeControl : 'blitz');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef({ terms:'', key:'' });
  const valid = validEntry(amount);
  const financials = computeContestFinancials(Number(amount));
  const create = async (event) => {
    event.preventDefault();
    if (busy || !valid) return;
    setBusy(true); setError('');
    const terms = `${Number(amount)}:${timeControl}:${rematchOf}`;
    if (request.current.terms !== terms) request.current = { terms, key:crypto.randomUUID().replaceAll('-','') };
    try {
      const result = await challengeRequest('create', { entryAmount:Number(amount), timeControl, requestKey:request.current.key, ...(rematchOf ? { rematchOf } : {}) });
      if (!result.path) throw new Error('The invitation was not returned. Please retry this request.');
      onCreated?.(result);
      navigate(result.path);
    } catch (err) {
      if (!handleChallengeGate(err,navigate,'/play')) setError(challengeErrorMessage(err));
    } finally { setBusy(false); }
  };
  return <form onSubmit={create} className="space-y-4" aria-label={rematchOf ? 'Create rematch' : 'Create shared challenge'}>
    <div><h3 className="text-lg font-bold text-white">{rematchOf ? 'Run it back' : 'Create a challenge'}</h3>
      <p className="mt-1 text-sm text-white/50">Choose your time control · No increment</p></div>
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
    <div className="grid grid-cols-3 gap-2">
      {[5,10,25,50,100,250].map(value => <button type="button" key={value} disabled={busy}
        onClick={() => setAmount(String(value))} className={`h-11 rounded-xl font-semibold ${Number(amount) === value ? 'gold-gradient text-black' : 'border border-white/10 bg-white/5 text-white hover:border-[#C9A84C]/50'}`}>${value}</button>)}
    </div>
    <label className="block text-sm text-white/60">Custom entry amount
      <input aria-label="Entry amount in USD" type="number" inputMode="decimal" min="5" max="5000" step="0.01" value={amount}
        onChange={event => setAmount(event.target.value)} disabled={busy}
        className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-black/25 px-3 text-white focus:border-[#C9A84C] focus:outline-none" />
    </label>
    {valid && financials.serviceFee !== null && <dl className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
      <div className="flex justify-between gap-4"><dt className="text-white/55">Entry Amount</dt><dd className="text-white">${financials.entryAmount.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-white/55">Platform Service Fee</dt><dd className="text-white">${financials.serviceFee.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-4 border-t border-white/10 pt-2 font-semibold"><dt className="text-white/75">Required per player</dt><dd className="text-white">${financials.totalCharge.toFixed(2)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-white/55">Winner award</dt><dd className="font-bold text-[#C9A84C]">${financials.potentialWinnerAward.toFixed(2)}</dd></div>
    </dl>}
    <p className="text-xs leading-relaxed text-white/50">Creating a link reserves no money. Both players must have available funds and pass eligibility checks when the challenge is accepted.</p>
    {rematchOf && <p className="text-xs text-[#C9A84C]">This rematch link is for your previous opponent. Share it with them after creation.</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <Button type="submit" disabled={busy || !valid} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black disabled:opacity-40">
      {busy ? <Loader2 size={17} className="mr-2 animate-spin" /> : <ArrowRight size={17} className="mr-2" />}
      {busy ? 'Creating link…' : rematchOf ? 'Create Rematch Link' : 'Create Challenge Link'}
    </Button>
    {onCancel && <button type="button" onClick={onCancel} disabled={busy} className="w-full py-2 text-sm text-white/50">Back</button>}
  </form>;
}
