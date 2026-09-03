import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link, useOutletContext } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import Logo from "@/components/Logo";
import RestrictedModeBanner from "@/components/RestrictedModeBanner";
import TransactionHistory from "@/components/wallet/TransactionHistory";
import SeamlessFundingPanel from "@/components/wallet/SeamlessFundingPanel";
import SocureIdentityVerificationPanel from "@/components/wallet/SocureIdentityVerificationPanel";
import NotifyAtLaunchModal from "@/components/NotifyAtLaunchModal";

// Pre-launch notice shown above identity verification while real-money play
// is still being finished. Remove this block (and the NotifyAtLaunchModal
// wiring below) once ChessBet has officially launched real-money contests.
function RealMoneyLaunchNotice({ onNotifyClick }) {
  return (
    <div className="rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/[0.05] p-4 flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
        <Sparkles size={18} className="text-[#C9A84C]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">Real-money play is almost here</p>
        <p className="text-xs text-white/50 mt-1">
          We're putting the finishing touches on real-money contests, and they'll be open soon. In the
          meantime, you can get everything set up below.{" "}
          <button
            type="button"
            onClick={onNotifyClick}
            className="text-[#C9A84C] underline underline-offset-2 hover:text-[#E2C66E]"
          >
            Click here to be notified the moment it launches.
          </button>
        </p>
      </div>
    </div>
  );
}

const TX_PAGE_SIZE = 20;
const MATCH_HISTORY_PAGE_SIZE = 500;

async function listCompletedMatchesForPlayer(field, userId) {
  const matches = [];
  let skip = 0;
  while (true) {
    const page = await base44.entities.Match.filter(
      { launch_epoch: 2, status: "completed", [field]: userId },
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
  // Set by JurisdictionAccessGuard: { allowed, reason, promptEligible }. The
  // Wallet route is the one protected route the guard lets a jurisdiction-
  // blocked user reach (see JurisdictionAccessGuard.jsx) so balance and
  // withdrawal stay available regardless of jurisdiction. Deposit- and
  // gameplay-adjacent actions (identity verification, bank linking) still
  // re-check jurisdiction themselves immediately before starting, so this
  // value is passed through for context/messaging only, not used to hide the
  // page itself.
  const jurisdictionDecision = /** @type {{ allowed: boolean, reason?: string, promptEligible?: boolean } | null} */ (useOutletContext());
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
  const [fullName, setFullName] = useState("");
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // Loads only the transactions needed for the given page, plus a lightweight
  // (ids-only) count of the full history for the "Showing X-Y of Z" label and
  // page count — never pulls the full transaction history into the browser.
  const loadTransactions = async (uid, page) => {
    const skip = (page - 1) * TX_PAGE_SIZE;
    const [txs, allIds] = await Promise.all([
      base44.entities.WalletTransaction.filter({ launch_epoch: 2, user_id: uid }, "-created_date", TX_PAGE_SIZE, skip),
      base44.entities.WalletTransaction.filter({ launch_epoch: 2, user_id: uid }, "-created_date", 5000, 0, ["id"]),
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
      ).filter((match) => match?.launch_epoch === 2);

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
    let me = await base44.auth.me();
    if (me.launch_epoch !== 2) {
      await base44.functions.invoke("ensureLaunchEpoch", {});
      me = await base44.auth.me();
    }
    setUserId(me.id);
    setWithdrawalHold(!!me.withdrawal_hold);
    setAccountState(me.account_state || "verified");
    setIdentityStatus(me.identity_verification_status || "not_started");
    setFullName(me.full_name || me.name || "");
    // The wallet is always created by the backend (ensureWallet, as
    // the service role) so there is exactly one per user. Never create a
    // wallet from the client — that previously produced a duplicate wallet
    // (user-role created, which the financial backend updated separately from
    // the one the UI showed) and split balances. If none is visible yet,
    // invoke the canonical creator.
    const wallets = await base44.entities.Wallet.filter({ user_id: me.id });
    if (wallets.length > 0) {
      setWallet(wallets[0]);
    } else {
      const { data } = await base44.functions.invoke("ensureWallet", {});
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
        <RestrictedModeBanner />

        {jurisdictionDecision && !jurisdictionDecision.allowed && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-center">
            <p className="text-xs text-amber-200/80">
              {jurisdictionDecision.reason ||
                "Paid contests aren't available from your current location."}{" "}
              Your balance stays yours — you can still withdraw it below.
            </p>
          </div>
        )}

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

        <RealMoneyLaunchNotice onNotifyClick={() => setNotifyModalOpen(true)} />

        <SocureIdentityVerificationPanel
          status={identityStatus}
          fullName={fullName}
          onNameSaved={setFullName}
          wallet={wallet}
          onRefresh={loadData}
        />

        <NotifyAtLaunchModal open={notifyModalOpen} onOpenChange={setNotifyModalOpen} />

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