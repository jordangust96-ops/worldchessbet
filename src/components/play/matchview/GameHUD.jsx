import React, { useState, useEffect, useMemo, useRef } from "react";
import { Chess } from "chess.js";
import { base44 } from "@/api/base44Client";
import { useChessClock } from "@/hooks/useChessClock";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import MovementModeToggle from "@/components/play/MovementModeToggle";
import SoundToggle from "@/components/play/SoundToggle";
import OpponentConnectionBanner from "@/components/play/matchview/OpponentConnectionBanner";
import ReportContestButton from "@/components/disputes/ReportContestButton";
import FoundingPlayerBadge from "@/components/profile/FoundingPlayerBadge";
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

const CAPTURE_PIECES = [
  ["q", "queen"],
  ["r", "rook"],
  ["b", "bishop"],
  ["n", "knight"],
  ["p", "pawn"],
];

function CapturedPieces({ counts, color, className }) {
  const groups = CAPTURE_PIECES.filter(([piece]) => counts?.[piece]);
  const description = groups.map(([piece, name]) => {
    const count = counts[piece];
    return `${count} ${name}${count === 1 ? "" : "s"}`;
  }).join(", ");

  return (
    <span
      className={className}
      role={description ? "img" : undefined}
      aria-label={description ? `Captured ${color === "w" ? "white" : "black"} pieces: ${description}` : undefined}
    >
      {groups.map(([piece]) => (
        <span key={piece} aria-hidden="true" className="inline-flex shrink-0 items-center">
          <svg
            className={`size-3 lg:size-[15px] ${color === "b" ? "drop-shadow-[0_0_0.65px_#e5ca7a]" : ""}`}
            viewBox="0 0 45 45"
            focusable="false"
          >
            <use href={`/captured-pieces.svg#${color}${piece.toUpperCase()}`} />
          </svg>
          {counts[piece] > 1 && (
            <span className="text-[9px] tabular-nums leading-none text-white/70">{counts[piece]}</span>
          )}
        </span>
      ))}
    </span>
  );
}

export default function GameHUD({
  match,
  game,
  onGameSync,
  userId,
  movementMode,
  onMovementModeChange,
  touchOnlyInput,
  soundEnabled,
  onSoundEnabledChange,
}) {
  const [names, setNames] = useState({ me: "You", opponent: "Opponent" });
  const [founding, setFounding] = useState({ me: false, opponent: false });
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [resigning, setResigning] = useState(false);
  const [offeringDraw, setOfferingDraw] = useState(false);
  const [respondingDraw, setRespondingDraw] = useState(false);
  const [integrityReviewActive, setIntegrityReviewActive] = useState(false);
  const displayMs = useChessClock(game, onGameSync);
  const { toast } = useToast();

  // Admin-only visibility: surfaces whether this contest is linked to an open
  // integrity flag. Never shown to the flagged player(s).
  useEffect(() => {
    const checkIntegrityReview = async () => {
      const me = await base44.auth.me();
      if (me?.role !== "admin" || !match?.id) return;
      const linkedFlags = await base44.entities.IntegrityFlag.filter({ match_id: match.id });
      setIntegrityReviewActive(linkedFlags.some((f) => f.status === "open" || f.status === "under_review"));
    };
    checkIntegrityReview();
  }, [match?.id]);

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
    } catch (error) {
      toast({
        title: "Draw offer failed",
        description: error?.response?.data?.error || "Could not send the draw offer. Please try again.",
        variant: "destructive",
      });
    } finally {
      setOfferingDraw(false);
    }
  };

  const handleDrawResponse = async (action) => {
    setRespondingDraw(true);
    try {
      await base44.functions.invoke("respondDraw", { gameId: game.id, action });
    } catch (error) {
      toast({
        title: "Action failed",
        description: error?.response?.data?.error || "Could not respond to the draw offer. Please try again.",
        variant: "destructive",
      });
    } finally {
      setRespondingDraw(false);
    }
  };

  const isP1 = match.player1_id === userId;
  const myColor = isP1 ? "w" : "b";
  const opponentId = isP1 ? match.player2_id : match.player1_id;
  const opponentColorFull = isP1 ? "black" : "white";
  const opponentConnection = displayMs.disconnect?.[opponentColorFull];

  useEffect(() => {
    const load = async () => {
      const ids = [userId, opponentId].filter(Boolean);
      if (ids.length === 0) return;
      const { data } = await base44.functions.invoke("getUserDisplayNames", { userIds: ids });
      setNames({
        me: data?.names?.[userId] || "You",
        opponent: data?.names?.[opponentId] || "Opponent",
      });
      setFounding({
        me: !!data?.foundingPlayers?.[userId],
        opponent: !!data?.foundingPlayers?.[opponentId],
      });
    };
    load();
  }, [userId, opponentId]);

  const { activeColor, moveNumber, lastMove, capturedBy, positionStatus } = useMemo(() => {
    const fen = game?.fen;
    if (!fen) {
      return { activeColor: "w", moveNumber: 1, lastMove: null, capturedBy: {}, positionStatus: "Waiting for Server" };
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
    // Use the same replay as the status display. Replay the saved move log if
    // an older record does not have a usable PGN.
    if (!history.length && game.move_log?.length) {
      try {
        const replay = new Chess();
        for (const entry of game.move_log) replay.move(entry.san);
        history = replay.history({ verbose: true });
      } catch {
        history = [];
      }
    }
    const last = history[history.length - 1];
    const capturedBy = { w: {}, b: {} };
    for (const move of history) {
      if (!move.captured) continue;
      const counts = capturedBy[move.color];
      counts[move.captured] = (counts[move.captured] ?? 0) + 1;
    }

    let positionStatus = null;
    if (chess.isCheckmate()) positionStatus = "Checkmate";
    else if (chess.isDraw()) positionStatus = "Draw";
    else if (chess.isCheck()) positionStatus = "Check";

    return {
      activeColor: active,
      moveNumber: fullMoveNumber,
      lastMove: last ? `${last.from} → ${last.to}` : null,
      capturedBy,
      positionStatus,
    };
  }, [game?.fen, game?.pgn, game?.move_log]);

  const PlayerCard = ({ name, isFounder, colorLabel, colorKey }) => {
    const isActive = activeColor === colorKey;
    const clock = formatClock(displayMs[colorKey]);
    return (
      <div
        className={`game-player-card min-w-0 rounded-2xl border p-2 transition-colors lg:px-3 ${
          isActive
            ? "bg-[#C9A84C]/[0.07] border-[#C9A84C]/30 shadow-[0_0_16px_rgba(201,168,76,0.15)]"
            : "bg-white/[0.03] border-white/5"
        }`}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-0.5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-y-0">
          <p className="col-span-2 col-start-1 row-start-2 flex min-w-0 items-center gap-1.5 text-xs font-bold text-white lg:row-start-1 lg:text-sm">
            <span className="truncate" title={name}>{name}</span>
            {isFounder && <span className="flex shrink-0"><FoundingPlayerBadge /></span>}
          </p>
          <span className="col-start-2 row-start-1 justify-self-end text-[10px] uppercase leading-[15px] tracking-widest text-white/30 lg:col-start-1 lg:row-start-2 lg:justify-self-start">
            {colorLabel}
          </span>
          <CapturedPieces
            counts={capturedBy[colorKey]}
            color={colorKey === "w" ? "b" : "w"}
            className="col-span-2 col-start-1 row-start-3 flex h-[15px] items-center gap-px lg:col-span-1 lg:col-start-2 lg:row-start-2 lg:gap-0.5"
          />
          <p
            className={`col-start-1 row-start-1 shrink-0 font-mono text-xl font-bold leading-none tabular-nums lg:col-start-3 lg:row-span-2 ${isActive ? "text-[#C9A84C]" : "text-white/60"}`}
            role="timer"
            aria-label={`${colorLabel} clock, ${clock}`}
          >
            {clock}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="game-hud flex flex-col gap-3 lg:justify-between" data-opponent-disconnected={opponentConnection ? "" : undefined}>
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${opponentConnection ? "lg:sticky lg:top-0 lg:z-10 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:rounded-xl lg:bg-[#151515]" : ""}`}>
        <div className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 ${opponentConnection ? "lg:justify-start" : ""}`}>
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-green-500" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
              {match.play_mode === "free" ? "Free Match" : "Money Match"}
            </p>
          </div>
          {positionStatus && <span className="text-xs font-semibold text-white/80">{positionStatus}</span>}
        </div>
        {opponentConnection && (
          <OpponentConnectionBanner
            connection={opponentConnection}
            serverNowMs={displayMs.serverNowMs}
          />
        )}
      </div>
      {integrityReviewActive && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">Integrity Review Active</p>
        </div>
      )}

      {/* Section 2 — Players */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        <PlayerCard
          name={myColor === "w" ? names.me : names.opponent}
          isFounder={myColor === "w" ? founding.me : founding.opponent}
          colorLabel="White"
          colorKey="w"
        />
        <PlayerCard
          name={myColor === "b" ? names.me : names.opponent}
          isFounder={myColor === "b" ? founding.me : founding.opponent}
          colorLabel="Black"
          colorKey="b"
        />
      </div>

      <div className="hidden lg:grid grid-cols-2 gap-2.5">
        <div className="game-contest-stat rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-3">
          <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]/60 mb-0.5">{match.play_mode==='free'?'Play mode':'Entry Amount'}</p>
          <p className="text-base font-bold text-[#C9A84C]">{match.play_mode==='free'?'Free play':`$${match.wager_amount.toFixed(2)}`}</p>
        </div>
        <div className="game-contest-stat rounded-2xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Time Control</p>
          <p className="text-sm font-bold text-white">{match.display_name}</p>
        </div>
      </div>

      <div className="game-position-details flex h-12 flex-col justify-center gap-0.5 rounded-xl bg-white/[0.03] px-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Move Number</span>
          <span className="text-xs font-semibold tabular-nums text-white/80">{moveNumber}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Last Move</span>
          <span className="font-mono text-xs font-semibold text-white/80">{lastMove || "Opening Position"}</span>
        </div>
      </div>

      {/* Player preferences */}
      <div className={touchOnlyInput ? undefined : "game-hud-preferences space-y-2"}>
        <div className="game-hud-sound flex items-center justify-between gap-3 px-1">
          <p className="text-[10px] uppercase tracking-widest text-white/30">Match Sound</p>
          <SoundToggle enabled={soundEnabled} onChange={onSoundEnabledChange} compact />
        </div>
        {!touchOnlyInput && (
          <div className="game-hud-movement space-y-1.5">
            <p className="game-hud-movement-label text-[10px] uppercase tracking-widest text-white/30 px-1">
              Movement Mode
            </p>
            <MovementModeToggle mode={movementMode} onChange={onMovementModeChange} />
          </div>
        )}
      </div>

      {/* Section 5 — Game Controls */}
      <div className="game-hud-actions flex items-center gap-2">
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

      <div className="flex justify-center">
        <ReportContestButton matchId={match.id} gameId={game?.id} />
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