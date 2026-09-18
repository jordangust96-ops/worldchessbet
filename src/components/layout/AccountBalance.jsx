import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { challengeRequest } from '@/lib/challengeApi';

export default function AccountBalance() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const client = useQueryClient();
  const queryKey = ['header-wallet', user?.id];
  const { data, isError } = useQuery({
    queryKey, enabled: !!user?.id, staleTime: 10000,
    refetchInterval: 30000, refetchIntervalInBackground: false, refetchOnWindowFocus: true,
    queryFn: async () => {
      // Wallet is the materialized ledger source of truth. Read it directly so
      // a backend-function routing incident can never make an intact balance
      // disappear from the global header.
      const wallets = await base44.entities.Wallet.filter({ user_id: user.id });
      const wallet = wallets[0];
      if (!wallet) throw new Error('Wallet unavailable');

      let pendingCents = 0;
      for (let skip = 0; ; skip += 500) {
        const rows = await base44.entities.WalletTransaction.filter(
          { launch_epoch: 2, user_id: user.id, type: 'deposit', status: 'pending' },
          '-created_date', 500, skip, ['amount']);
        pendingCents += rows.reduce((sum, row) => sum + Math.round(Number(row.amount || 0) * 100), 0);
        if (rows.length < 500) break;
      }
      // Held balance also includes withdrawals, deposits and other holds.
      // Only the match-specific summary can label funds as match reservations.
      // Keep the available balance visible if that optional summary is unavailable.
      const summary = await challengeRequest('wallet_summary').catch(() => null);
      return {
        balance: Number(wallet.available_balance ?? wallet.balance ?? 0),
        reserved: Number(summary?.reserved_for_matches ?? 0),
        pending: pendingCents / 100,
      };
    },
  });
  useEffect(() => {
    if (!user?.id) return;
    const changed = event => {
      if (event.data?.user_id === user.id || event.type === 'delete')
        client.invalidateQueries({ queryKey: ['header-wallet', user.id] });
    };
    const stopWallet = base44.entities.Wallet.subscribe(changed);
    const stopMatches = base44.entities.Match.subscribe(event => { if ([event.data?.player1_id,event.data?.player2_id].includes(user.id) || event.type==='delete') client.invalidateQueries({queryKey:['header-wallet',user.id]}); });
    const stopTransactions = base44.entities.WalletTransaction.subscribe(changed);
    return () => { stopWallet(); stopTransactions(); stopMatches(); };
  }, [user?.id, client]);
  const content = <>
    <span className="block text-[10px] uppercase tracking-widest text-white/40">Balance</span>
    <span className="block text-lg font-bold leading-6 text-[#C9A84C] tabular-nums">{data ? `$${data.balance.toFixed(2)}` : '—'}</span>
    {data?.reserved > 0 && <span className="block text-xs font-normal leading-4 text-white/65 tabular-nums">${data.reserved.toFixed(2)} reserved for matches</span>}
    {data?.pending > 0 && <span className="block text-xs font-normal leading-4 text-white/50 tabular-nums">${data.pending.toFixed(2)} pending deposit</span>}
    {isError && <span className="block text-[10px] text-white/50">Balance update unavailable</span>}
  </>;
  return pathname.replace(/\/$/, '') === '/wallet'
    ? <div className="text-right" aria-label="Wallet balance">{content}</div>
    : <Link to="/wallet" className="rounded-md text-right focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A84C]" aria-label="View wallet balance, match reservations and pending deposits">{content}</Link>;
}