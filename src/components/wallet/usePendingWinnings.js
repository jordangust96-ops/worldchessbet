import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

// Display only: the ledger and release service remain the balance authorities.
export default function usePendingWinnings(userId) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['pending-winnings', userId],
    enabled: !!userId,
    staleTime: 10000,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      let cents = 0;
      for (let skip = 0; ; skip += 500) {
        const rows = await base44.entities.WalletTransaction.filter(
          { launch_epoch: 2, user_id: userId, type: 'payout', status: 'completed', payout_hold_status: 'held' },
          '-created_date', 500, skip, ['amount']);
        cents += rows.reduce((sum, row) => sum + Math.round(Number(row.amount || 0) * 100), 0);
        if (rows.length < 500) break;
      }
      return cents / 100;
    },
  });
  useEffect(() => {
    if (!userId) return;
    return base44.entities.WalletTransaction.subscribe(event => {
      if (event.data?.user_id === userId || event.type === 'delete')
        client.invalidateQueries({ queryKey: ['pending-winnings', userId] });
    });
  }, [userId, client]);
  return query;
}
