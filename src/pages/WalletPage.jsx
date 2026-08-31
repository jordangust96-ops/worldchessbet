import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import Logo from "@/components/Logo";
import DemoModeNotice from "@/components/DemoModeNotice";
import RestrictedModeBanner from "@/components/RestrictedModeBanner";
import TransactionHistory from "@/components/wallet/TransactionHistory";
import SeamlessFundingPanel from "@/components/wallet/SeamlessFundingPanel";
import SocureIdentityVerificationPanel from "@/components/wallet/SocureIdentityVerificationPanel";

const TX_PAGE_SIZE = 20;
const MATCH_HISTORY_PAGE_SIZE = 500;

async function listCompletedMatchesForPlayer(field, userId) {
  const matches = [];
  let skip = 0;
  while (true) {
    const page = await base44.entities.Match.filter(
      { status: "completed", [field]: userId },
      "-created_date",
      MATCH_HISTORY_PAGE_SIZE,
      skip
    );
    matches.push(...page);
    if (page.length < MATCH_HISTORY_PAGE_SIZE) return matches;
    skip += page.length;
  }
}

export default function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [userId, setUserId] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [txPage, setTxPage] = useState(1);
  const [txTotalCount, setTxTotalCount] = useState(0);
  const [matchDetailsById, setMatchDetailsById] = useState({});
  const [stats, setStats] = useState({ won: 0, lost: 0, wagered: 0 });
  const [loading, setLoading] = useState(true);
  const [withdrawalHold, setWithdrawalHold] = useState(false);
  const [accountState, setAccountState] = useState("verified");
  const [identityStatus, setIdentityStatus] = useState("not_started");

  useEffect(() => {
    loadData();
  }, []);

  // Loads only the transactions needed for the given page, plus a lightweight
  // (ids-only) count of the full history for the "Showing X-Y of Z" label and
  // page count — never pulls the full transaction history into the browser.
  const loadTransactions = async (uid, page) => {
    const skip = (page - 1) * TX_PAGE_SIZE;
    const [txs, allIds] = await Promise.all([
      base44.entities.WalletTransaction.filter({ user_id: uid }, "-created_date", TX_PAGE_SIZE, skip),
      base44.entities.WalletTransaction.filter({ user_id: uid }, "-created_date", 5000, 0, ["id"]),
    ]);
    setTransactions(txs);
    setTxTotalCount(allIds.length);
    setTxPage(page);

    // Enrich only the visible page with participant-readable contest facts.
    // WalletTransaction remains the financial source of truth; this map is
    // read-only display context and never changes ledger or match records.
    const matchIds = [...new Set(txs.map((tx) => tx.match_id).filter(Boolean))];
    if (matchIds.length === 0) {
      setMatchDetailsById({});
      return;
    }

    try {
      const matches = (
        await Promise.all(
          matchIds.map(async (matchId) => {
            try {
              return await base44.entities.Match.get(matchId);
            } catch {
              return null;
            }
          })
        )
      ).filter(Boolean);

      const opponentIds = [
        ...new Set(
          matches
            .map((match) => (match.player1_id === uid ? match.player2_id : match.player1_id))
            .filter(Boolean)
        ),
      ];
      let names = {};
      if (opponentIds.length > 0) {
        const { data } = await base44.functions.invoke("getUserDisplayNames", {
          userIds: opponentIds,
        });
        names = data?.names || {};
      }

      setMatchDetailsById(
        matches.reduce((details, match) => {
          const opponentId = match.player1_id === uid ? match.player2_id : match.player1_id;
          details[match.id] = {
            match,
            opponentName: names[opponentId] || "Opponent",
          };
          return details;
        }, {})
      );
    } catch {
      // Transaction history must remain available even if optional contest
      // context cannot be loaded for an older record.
      setMatchDetailsById({});
    }
  };

  const handleTxPageChange = (page) => {
    if (!userId) return;
    loadTransactions(userId, page);
  };

  const loadData = async () => {
    const me = await base44.auth.me();
    setUserId(me.id);
    setWithdrawalHold(!!me.withdrawal_hold);
    setAccountState(me.account_state || "verified");
    setIdentityStatus(me.identity_verification_status || "not_started");
    // The wallet is always created by the backend (grantEarlyAccessFunds, as
    // the service role) so there is exactly one per user. Never create a
    // wallet from the client — that previously produced a duplicate wallet
    // (user-role created, which the financial backend updated separately from
    // the one the UI showed) and split balances. If none is visible yet,
    // invoke the canonical creator.
    const wallets = await base44.entities.Wallet.filter({ user_id: me.id });
    if (wallets.length > 0) {
      setWallet(wallets[0]);
    } else {
      const { data } = await base44.functions.invoke("grantEarlyAccessFunds", {});
      setWallet(data.wallet);
    }
    await loadTransactions(me.id, 1);

    // Keep monetary history derived from authoritative completed Matches, but
    // query only this player's records instead of loading every completed match
    // on the platform. Pagination preserves complete history as usage grows.
    const [asPlayer1, asPlayer2] = await Promise.all([
      listCompletedMatchesForPlayer("player1_id", me.id),
      listCompletedMatchesForPlayer("player2_id", me.id),
    ]);
    const myMatches = [...new Map([...asPlayer1, ...asPlayer2].map((match) => [match.id, match])).values()];
    let won = 0;
    let lost = 0;
    let wagered = 0;
    myMatches.forEach((m) => {
      wagered += m.wager_amount || 0;
      if (m.result === "draw" || !m.winner_id) return;
      if (m.winner_id === me.id) {
        // Winner receives 100% of the combined Contest Entry Amounts — the
        // Platform Service Fee is a separate fixed-dollar charge, never a
        // percentage deducted from the pot.
        won += (m.wager_amount || 0) * 2;
      } else {
        lost += m.wager_amount || 0;
      }
    });
    setStats({ won, lost, wagered });

    setLoading(false);
  };


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 pt-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <Link to="/play" className="inline-block">
          <Logo size="sm" />
        </Link>
        <DemoModeNotice />
        <RestrictedModeBanner />

        {/* Balance Card */}
        <div className="rounded-3xl bg-gradient-to-br from-[#1A1A1A] to-[#111] border border-white/5 p-6 text-center">
          <p className="text-xs uppercase tracking-widest text-white/40 mb-2">Total Balance</p>
          <h1 className="text-4xl font-extrabold text-white mb-1">
            ${wallet?.balance?.toFixed(2)}
          </h1>
          <div className="flex items-center justify-center gap-6 mt-4">
            <div>
              <p className="text-[10px] text-white/30 uppercase">Won</p>
              <p className="text-sm font-bold text-[#C9A84C]">${stats.won.toFixed(2)}</p>
            </div>
            <div className="w-px h-6 bg-white/10" />
            <div>
              <p className="text-[10px] text-white/30 uppercase">Lost</p>
              <p className="text-sm font-bold text-red-400">${stats.lost.toFixed(2)}</p>
            </div>
            <div className="w-px h-6 bg-white/10" />
            <div>
              <p className="text-[10px] text-white/30 uppercase">Entered</p>
              <p className="text-sm font-bold text-white/60">${stats.wagered.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <SocureIdentityVerificationPanel status={identityStatus} />

        <SeamlessFundingPanel
          wallet={wallet}
          accountState={accountState}
          withdrawalHold={withdrawalHold}
          onRefresh={loadData}
        />

        {/* Transactions */}
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-4">Transaction History</h3>
          <TransactionHistory
            transactions={transactions}
            matchDetailsById={matchDetailsById}
            userId={userId}
            page={txPage}
            pageSize={TX_PAGE_SIZE}
            totalCount={txTotalCount}
            onPageChange={handleTxPageChange}
          />
        </div>
      </motion.div>
    </div>
  );
}