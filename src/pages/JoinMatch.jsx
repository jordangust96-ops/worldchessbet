import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Crown, Loader2, Shield, User } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { isMfaVerified } from "@/lib/mfaSession";
import { setPostAuthRedirect, clearPostAuthRedirect } from "@/lib/postAuthRedirect";
import { computeContestFinancials } from "@/lib/contestFinancials";

// Entry point for a Private Match invitation link (/join/:inviteCode). Handles
// its own auth/MFA gating (rather than the shared ProtectedRoute tree) so an
// unauthenticated visitor can be sent to sign in/register and land back on
// this exact invitation afterwards.
export default function JoinMatch() {
  const { inviteCode } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading"); // loading | invalid | confirm
  const [match, setMatch] = useState(null);
  const [hostName, setHostName] = useState("Host");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const run = async () => {
      const authed = await base44.auth.isAuthenticated();
      if (!authed) {
        setPostAuthRedirect(`/join/${inviteCode}`);
        navigate("/login", { replace: true });
        return;
      }
      if (!isMfaVerified()) {
        setPostAuthRedirect(`/join/${inviteCode}`);
        navigate("/verify-mfa", { replace: true });
        return;
      }

      clearPostAuthRedirect();

      const me = await base44.auth.me();
      const matches = await base44.entities.Match.filter({ invite_code: inviteCode });
      const found = matches?.[0];

      if (!found || !found.is_private || found.status === "completed" || found.status === "cancelled") {
        setStatus("invalid");
        return;
      }
      // Host revisiting their own link, or the invited player who already
      // joined — both belong on Home, which will surface the live match.
      if (found.player1_id === me.id || found.player2_id === me.id) {
        navigate("/", { replace: true });
        return;
      }
      if (found.status !== "searching") {
        // Someone else already took the open slot.
        setStatus("invalid");
        return;
      }

      const { data } = await base44.functions.invoke("getUserDisplayNames", { userIds: [found.player1_id] });
      setHostName(data?.names?.[found.player1_id] || "Host");
      setMatch(found);
      setStatus("confirm");
    };
    run();
  }, [inviteCode, navigate]);

  const handleAccept = async () => {
    setJoining(true);
    try {
      // Reserves the opponent slot and moves both players into the shared
      // Preparing Match screen — Fair Play certification and the Entry
      // Amount reservation both happen there, identically to a public match.
      await base44.functions.invoke("acceptMatch", { matchId: match.id });
      navigate("/", { replace: true });
    } catch (err) {
      setStatus("invalid");
    } finally {
      setJoining(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-5">
        <div className="text-center space-y-4 max-w-sm">
          <Shield size={32} className="text-white/20 mx-auto" />
          <p className="text-lg font-bold text-white">This invitation is no longer available.</p>
          <Button
            onClick={() => navigate("/")}
            className="gold-gradient text-black font-bold rounded-2xl h-11 px-6"
          >
            Return to Play
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 py-10 flex items-center justify-center">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center justify-center gap-2">
          <Crown size={18} strokeWidth={1.5} className="text-[#C9A84C]" />
          <span className="text-sm font-bold tracking-tight gold-text">ChessBet</span>
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-[#1A1A1A] to-[#111] border border-white/5 p-6 space-y-5">
          <p className="text-[10px] uppercase tracking-widest text-white/30 text-center">
            Private Match Invitation
          </p>

          <div className="flex items-center gap-3 justify-center">
            <div className="w-11 h-11 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
              <User size={18} className="text-white/50" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30">Host</p>
              <p className="text-base font-bold text-white">{hostName}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-4">
              <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]/60 mb-1">Entry Amount</p>
              <p className="text-xl font-bold text-[#C9A84C]">${match.wager_amount.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.03] p-4">
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Time Control</p>
              <p className="text-base font-bold text-white">{match.display_name}</p>
            </div>
          </div>

          <div className="rounded-2xl bg-white/[0.03] p-4 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Match Summary</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">Contest Entry Amount</span>
              <span className="font-semibold text-white/80">${computeContestFinancials(match.wager_amount).entryAmount.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">Platform Service Fee (10%)</span>
              <span className="font-semibold text-white/80">${computeContestFinancials(match.wager_amount).serviceFee.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">Total Charged</span>
              <span className="font-semibold text-white/80">${computeContestFinancials(match.wager_amount).totalCharge.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-sm font-semibold text-white/70">Winner Award</span>
              <span className="text-lg font-extrabold text-[#C9A84C]">
                ${computeContestFinancials(match.wager_amount).potentialWinnerAward.toFixed(2)}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-center text-white/30">
            After joining, you and the host will both certify Fair Play and reserve your entry amount before the game begins.
          </p>

          <Button
            onClick={handleAccept}
            disabled={joining}
            className="w-full h-12 rounded-2xl font-bold gold-gradient text-black hover:opacity-90"
          >
            {joining ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
            Join Challenge
          </Button>
        </div>
      </div>
    </div>
  );
}