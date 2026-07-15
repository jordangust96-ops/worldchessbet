import React, { useState, useEffect, useMemo, useRef } from "react";
import { Chess } from "chess.js";
import { base44 } from "@/api/base44Client";
import { useChessClock } from "@/hooks/useChessClock";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import MovementModeToggle from "@/components/play/MovementModeToggle";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil((ms ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function GameHUD({ match, game, userId, movementMode, onMovementModeChange }) {
  const [names, setNames] = useState({ me: "You", opponent: "Opponent" });
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [resigning, setResigning] = useState(false);
  const [offeringDraw, setOfferingDraw] = useState(false);
  const [respondingDraw, setRespondingDraw] = useState(false);
  const displayMs = useChessClock(game);
  const { toast } = useToast();

  const drawOfferedByMe = game?.draw_offered_by === userId;
  const drawOfferedByOpponent = !!game?.draw_offered_by && game.draw_offered_by !== userId;

  // Notify the offering player when their draw offer is declined (as opposed to
  // accepted, which instead ends the game and surfaces the GameSummary screen).
  const prevDrawOfferedByMeRef = useRef(false);
  useEffect(() => {
    if (prevDrawOfferedByMeRef.current && !drawOfferedByMe && game?.status !== "completed") {
      toast({
        title: "Draw Declined",
        description: "Your opponent declined the draw offer. The game continues.",
      });
    }
    prevDrawOfferedByMeRef.current = drawOfferedByMe;
  }, [drawOfferedByMe, game?.status, toast]);

  const handleResign = async () => {
    setResigning(true);
    try {
      await base44.functions.invoke("resignGame", { gameId: game.id });
    } finally {
      setResigning(false);
      setShowResignConfirm(false);
    }
  };

  const handleOfferDraw = async () => {
    setOfferingDraw(true);
    try {
      await base44.functions.invoke("respondDraw", { gameId: game.id, action: "offer" });
    } finally {
      setOfferingDraw(false);
    }
  };

  const handleDrawResponse = async (action) => {
    setRespondingDraw(true);
    try {
      await base44.functions.invoke("respondDraw", { gameId: game.id, action });
    } finally {
      setRespondingDraw(false);
    }
  };

  const isP1 = match.player1_id === userId;
  const myColor = isP1 ? "w" : "b";
  const opponentId = isP1 ? match.player2_id : match.player1_id;

  useEffect(() => {
    const load = async () => {
      const ids = [userId, opponentId].filter(Boolean);
      if (ids.length === 0) return;
      const { data } = await base44.functions.invoke("getUserDisplayNames", { userIds: ids });
      setNames({
        me: data?.names?.[userId] || "You",
        opponent: data?.names?.[opponentId] || "Opponent",
      });
    };
    load();
  }, [userId, opponentId]);

  const { activeColor, moveNumber, lastMove, totalMoves, statusLabel } = useMemo(() => {
    const fen = game?.fen;
    if (!fen) {
      return { activeColor: "w", moveNumber: 1, lastMove: null, totalMoves: 0, statusLabel: "Waiting for Server" };
    }
    const chess = new Chess(fen);
    const active = fen.split(" ")[1] === "b" ? "b" : "w";
    const fullMoveNumber = parseInt(fen.split(" ")[5], 10) || 1;

    let history = [];
    if (game.pgn) {
      try {
        const replay = new Chess();
        replay.loadPgn(game.pgn);
        history = replay.history({ verbose: true });
      } catch (e) {
        history = [];
      }
    }
    const last = history[history.length - 1];

    let label;
    if (chess.isCheckmate()) label = "Checkmate";
    else if (chess.isDraw()) label = "Draw";
    else if (chess.isCheck()) label = "Check";
    else label = active === myColor ? "Your Move" : "Opponent's Turn";

    return {
      activeColor: active,
      moveNumber: fullMoveNumber,
      lastMove: last ? `${last.from} → ${last.to}` : null,
      totalMoves: history.length,
      statusLabel: label,
    };
  }, [game?.fen, game?.pgn, myColor]);

  const PlayerCard = ({ name, colorLabel, colorKey, clockMs }) => {
    const isActive = activeColor === colorKey;
    return (
      <div
        className={`rounded-2xl p-3.5 border transition-all ${
          isActive
            ? "bg-[#C9A84C]/[0.07] border-[#C9A84C]/30 shadow-[0_0_16px_rgba(201,168,76,0.15)]"
            : "bg-white/[0.03] border-white/5"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white">{name}</p>
            <p className="text-[10px] uppercase tracking-widest text-white/30">{colorLabel}</p>
          </div>
          <p className={`font-mono text-lg font-bold tabular-nums ${isActive ? "text-[#C9A84C]" : "text-white/60"}`}>
            {formatClock(colorKey === "w" ? displayMs.w : displayMs.b)}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 lg:space-y-3">
      {/* Section 1 — Match Status */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Live Match</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-3">
            <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]/60 mb-0.5">Entry Amount</p>
            <p className="text-base font-bold text-[#C9A84C]">${match.wager_amount.toFixed(2)}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Time Control</p>
            <p className="text-sm font-bold text-white">{match.display_name}</p>
          </div>
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-white/40">Move {moveNumber}</span>
          <span className="text-xs font-semibold text-white/80">{statusLabel}</span>
        </div>
      </div>

      <div className="h-px bg-white/[0.06]" />

      {/* Section 2 — Players */}
      <div className="space-y-2">
        <PlayerCard
          name={myColor === "w" ? names.me : names.opponent}
          colorLabel="White"
          colorKey="w"
        />
        <PlayerCard
          name={myColor === "b" ? names.me : names.opponent}
          colorLabel="Black"
          colorKey="b"
        />
      </div>

      <div className="h-px bg-white/[0.06]" />

      {/* Section 3 — Game Information */}
      <div className="rounded-2xl bg-white/[0.03] p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Current Turn</span>
          <span className="text-xs font-semibold text-white/80">{activeColor === "w" ? "White" : "Black"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Last Move</span>
          <span className="text-xs font-semibold text-white/80 font-mono">{lastMove || "Opening Position"}</span>
        </div>
      </div>

      {/* Section 4 — Connection Status */}
      <div className="flex items-center justify-center gap-1.5 pt-1">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        <span className="text-[10px] text-white/30">Live</span>
      </div>

      {/* Section 4.5 — Movement Mode */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-widest text-white/30 px-1">Movement Mode</p>
        <MovementModeToggle mode={movementMode} onChange={onMovementModeChange} />
      </div>

      {/* Section 5 — Game Controls */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowResignConfirm(true)}
          className="flex-1 h-9 rounded-xl text-xs font-semibold border-white/10 text-white/50 hover:text-red-400 hover:border-red-400/30 bg-transparent"
        >
          Resign
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={drawOfferedByMe || drawOfferedByOpponent || offeringDraw}
          onClick={handleOfferDraw}
          className="flex-1 h-9 rounded-xl text-xs font-semibold border-white/10 text-white/50 hover:text-white/80 bg-transparent"
        >
          {drawOfferedByMe ? "Draw Offered" : "Offer Draw"}
        </Button>
      </div>

      <AlertDialog open={showResignConfirm} onOpenChange={setShowResignConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resign this game?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately end the game and your opponent will be declared the winner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resigning}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={resigning} onClick={handleResign} className="bg-red-500 hover:bg-red-500/90">
              Confirm Resignation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={drawOfferedByOpponent} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Draw Offer</DialogTitle>
            <DialogDescription>Your opponent has offered a draw.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={respondingDraw}
              onClick={() => handleDrawResponse("decline")}
              className="border-white/10"
            >
              Decline
            </Button>
            <Button
              disabled={respondingDraw}
              onClick={() => handleDrawResponse("accept")}
              className="gold-gradient text-black hover:opacity-90"
            >
              Accept Draw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}