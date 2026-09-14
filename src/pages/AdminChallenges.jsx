import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { challengeRequest, challengeErrorMessage } from '@/lib/challengeApi';

export default function AdminChallenges() {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{setData(await challengeRequest('admin'));}catch(err){setError(challengeErrorMessage(err));}finally{setLoading(false);}
  },[]);
  useEffect(()=>{refresh();},[refresh]);
  const rows=useMemo(()=> (data?.challenges || []).filter(row=>[row.id,row.creatorId,row.recipientId,row.status,row.operationState,row.reservationGroupId].join(' ').toLowerCase().includes(query.toLowerCase())),[data,query]);
  return <main className="mx-auto max-w-6xl space-y-5 px-5 pb-24 pt-5 text-white">
    <Link to="/profile" className="inline-flex items-center gap-2 text-sm text-white/50"><ArrowLeft size={15}/>Admin Tools</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Challenge Operations</h1><p className="mt-1 text-sm text-white/50">Invitations, financial commitment, match handoff and recovery.</p></div>
      <Button onClick={refresh} disabled={loading} variant="outline" className="border-white/15 text-white/70">{loading?<Loader2 className="mr-2 animate-spin" size={15}/>:<RefreshCw className="mr-2" size={15}/>}Refresh</Button></div>
    {data && <>
      <p className="text-xs text-white/45">Read through {new Date(data.asOf).toLocaleString()}. Latest {data.challenges.length} challenges. Product-event counts below cover the preceding 24 hours; they are not ledger transactions.</p>
      {data.truncated && <p role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">This view reached its record limit. Counts and rows are partial; use Site Activity and Transaction Ledger for deeper review.</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Views','challenge.viewed'],['Funding interest','challenge.funding_intent'],['Claims','challenge.claimed'],['Pre-game releases','challenge.released']].map(([label,key])=><div key={key} className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-white/50">{label}</p><p className="mt-1 text-2xl font-bold text-[#C9A84C]">{data.counts24h[key] || 0}</p></div>)}</div>
    </>}
    <input aria-label="Search challenge operations" placeholder="Search challenge, player, status or ledger group" value={query} onChange={e=>setQuery(e.target.value)} className="h-12 w-full rounded-xl border border-white/15 bg-black/20 px-4 text-sm"/>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="space-y-3">{rows.map(row=><details key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <summary className="cursor-pointer"><span className="font-semibold">${Number(row.wager_amount).toFixed(2)} entry · ${Number(row.platform_service_fee).toFixed(2)} fee</span><span className="ml-3 text-sm text-[#C9A84C]">{row.status} / {row.operationState}</span><p className="mt-1 break-all font-mono text-xs text-white/40">{row.id}</p></summary>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">{[
        ['Creator',row.creatorId],['Recipient',row.recipientId || 'Not claimed'],['Created',row.createdAt],['Expires',row.challenge_expires_at],
        ['Claimed',row.challenge_claimed_at || row.preparation_started_at || '—'],['Game ID',row.game_id || 'Not started'],
        ['Both reservations recorded',row.player1_deposited && row.player2_deposited?'Yes':'No'],['Close reason',row.challenge_close_reason || '—'],
        ['Reservation ledger group',row.reservationGroupId || 'None'],['Release ledger group',row.releaseGroupId || 'None'],
      ].map(([label,value])=><div key={label}><dt className="text-xs text-white/40">{label}</dt><dd className="mt-1 break-all text-white/75">{value}</dd></div>)}</dl>
      <div className="mt-4 flex gap-4 text-sm"><Link to={`/admin/transaction-ledger?matchId=${row.id}`} className="text-[#C9A84C]">Open Transaction Ledger</Link><Link to={`/admin/user-financials?userId=${row.creatorId}`} className="text-white/60">Review Creator</Link></div>
    </details>)}</div>
    {!loading && !rows.length && !error && <p className="py-8 text-center text-white/40">No matching challenge invitations yet.</p>}
  </main>;
}
