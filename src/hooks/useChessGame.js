import { useState, useEffect, useCallback, useRef } from "react";
import { Chess } from "chess.js";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Derives the ply (half-move index) a FEN represents, so board updates can be
// ordered and compared regardless of which source (poll, realtime, optimistic
// local move) produced them. This is the single monotonic progress signal —
// any incoming state with a lower ply than what's already rendered is stale
// and must never be applied, or the board would visibly move backwards.
function plyFromFen(fenStr) {
  const parts = fenStr.split(" ");
  const turn = parts[1];
  const fullmove = parseInt(parts[5], 10) || 1;
  return (fullmove - 1) * 2 + (turn === "b" ? 1 : 0);
}

// Manages loading/creating the Game entity for a match, hydrating the board,
// and submitting moves to the submitMove backend function (the sole authority
// over FEN, PGN, status, result, and winner_id).
export function useChessGame(matchId, userId, active) {
  const [fen, setFen] = useState(START_FEN);
  const [game, setGame] = useState(null);
  const [color, setColor] = useState("white");
  const chessRef = useRef(new Chess());
  // Ply of the position currently rendered — the single source of truth for
  // ordering. Never let a lower-ply update overwrite it.
  const renderedPlyRef = useRef(0);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [legalTargets, setLegalTargets] = useState([]);
  const { toast } = useToast();

  const loadGame = useCallback(async () => {
    if (!matchId || !userId) return;
    const match = await base44.entities.Match.get(matchId);
    setColor(match.player1_id === userId ? "white" : "black");

    // getOrCreateGame is the single authoritative, idempotent source for the
    // Match's Game — both players calling this concurrently always converge
    // on the same Game id, eliminating the prior client-side race where each
    // player could independently create their own Game record.
    const { data } = await base44.functions.invoke("getOrCreateGame", { matchId });
    const g = data.game;
    setGame(g);
    chessRef.current.load(g.fen || START_FEN);
    setFen(chessRef.current.fen());
    renderedPlyRef.current = plyFromFen(chessRef.current.fen());
  }, [matchId, userId]);

  useEffect(() => {
    if (!active) {
      // Clear any previous match's game data so a dismissed/completed game can
      // never bleed into the next match's initial render.
      setGame(null);
      setFen(START_FEN);
      chessRef.current = new Chess();
      renderedPlyRef.current = 0;
      return;
    }
    loadGame();
  }, [active, loadGame]);

  useEffect(() => {
    if (!active || !game?.id) return;

    const applyLatest = (latest) => {
      // Reject any state that is behind what's already rendered — this is what
      // stops a delayed/in-flight poll or subscription event from ever
      // rolling the board back to an earlier position.
      const latestPly = plyFromFen(latest.fen);
      if (latestPly < renderedPlyRef.current) return;
      if (latest.fen !== chessRef.current.fen()) {
        chessRef.current.load(latest.fen);
        setFen(chessRef.current.fen());
      }
      renderedPlyRef.current = latestPly;
      setGame(latest);
      // Any externally-sourced position change (opponent's move, reconnect,
      // poll) invalidates whatever square was selected for click-to-move.
      setSelectedSquare(null);
      setLegalTargets([]);
    };

    // Recover the authoritative state immediately on (re)subscribe, e.g. after a
    // browser refresh or a dropped realtime connection being re-established.
    base44.entities.Game.get(game.id).then(applyLatest);

    // Fallback polling only runs while the realtime channel is suspected down —
    // browser offline, or the brief window right after reconnecting before the
    // next realtime event confirms the channel is healthy again. It stops the
    // instant any realtime event arrives, so normal gameplay never polls.
    let fallbackInterval = null;
    const stopFallback = () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };
    const startFallback = () => {
      if (fallbackInterval) return;
      fallbackInterval = setInterval(() => {
        base44.entities.Game.get(game.id).then(applyLatest);
      }, 2000);
    };

    const unsubscribe = base44.entities.Game.subscribe((event) => {
      if (event.data?.id !== game.id) return;
      if (event.type === "update" || event.type === "create") {
        applyLatest(event.data);
        // A live event proves realtime is healthy — no fallback needed.
        stopFallback();
      }
    });

    const handleOffline = () => startFallback();
    const handleOnline = () => {
      base44.entities.Game.get(game.id).then(applyLatest);
      startFallback();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    if (typeof navigator !== "undefined" && navigator.onLine === false) startFallback();

    return () => {
      unsubscribe();
      stopFallback();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [active, game?.id]);

  // Shared core used by both Drag & Drop (handleDrop) and Click to Move
  // (handleSquareClick) — the single path that ever calls submitMove, so both
  // input methods run through identical validation/optimistic-update/rollback logic.
  const attemptMove = useCallback(
    (sourceSquare, targetSquare) => {
      if (!game || game.status === "completed") return false;

      // Quick client-side legality check purely for instant snap-back UX.
      // The server remains the sole authority over the persisted game state.
      const preview = new Chess(chessRef.current.fen());
      let previewMove;
      try {
        previewMove = preview.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      } catch (e) {
        previewMove = null;
      }
      if (!previewMove) return false;

      const previousFen = chessRef.current.fen();

      // Optimistic local update for responsiveness; corrected/confirmed by the server response.
      chessRef.current.load(preview.fen());
      setFen(preview.fen());
      // Advance the progress marker immediately so any stale poll/subscription
      // response still reflecting the pre-move position gets rejected by
      // applyLatest instead of briefly rendering over this optimistic move.
      renderedPlyRef.current = plyFromFen(preview.fen());
      setSelectedSquare(null);
      setLegalTargets([]);

      (async () => {
        try {
          // The HTTP response only confirms success/failure. The authoritative board
          // update for both players comes exclusively from the Game realtime subscription.
          await base44.functions.invoke("submitMove", {
            gameId: game.id,
            from: sourceSquare,
            to: targetSquare,
            promotion: "q",
          });
        } catch (error) {
          // Server rejected the move — restore the previous position.
          chessRef.current.load(previousFen);
          setFen(previousFen);
          renderedPlyRef.current = plyFromFen(previousFen);
          toast({
            title: "Move rejected",
            description: error?.response?.data?.error || "That move could not be made.",
            variant: "destructive",
          });
        }
      })();

      return true;
    },
    [game, toast]
  );

  const handleDrop = useCallback(
    (sourceSquare, targetSquare) => attemptMove(sourceSquare, targetSquare),
    [attemptMove]
  );

  // Click to Move: click a legal piece to select it (highlighting legal
  // destinations), click a destination to complete the move, click the same
  // piece or an empty/illegal square to clear the selection.
  const handleSquareClick = useCallback(
    (square) => {
      if (!game || game.status === "completed") return;
      const chess = chessRef.current;
      const turn = chess.turn();

      if (selectedSquare) {
        if (square === selectedSquare) {
          setSelectedSquare(null);
          setLegalTargets([]);
          return;
        }
        if (legalTargets.includes(square)) {
          attemptMove(selectedSquare, square);
          return;
        }
        const piece = chess.get(square);
        if (piece && piece.color === turn) {
          const moves = chess.moves({ square, verbose: true });
          setSelectedSquare(moves.length > 0 ? square : null);
          setLegalTargets(moves.map((m) => m.to));
        } else {
          setSelectedSquare(null);
          setLegalTargets([]);
        }
        return;
      }

      const piece = chess.get(square);
      if (piece && piece.color === turn) {
        const moves = chess.moves({ square, verbose: true });
        if (moves.length === 0) return;
        setSelectedSquare(square);
        setLegalTargets(moves.map((m) => m.to));
      }
    },
    [game, selectedSquare, legalTargets, attemptMove]
  );

  return {
    fen,
    handleDrop,
    handleSquareClick,
    selectedSquare,
    legalTargets,
    orientation: color,
    gameStatus: game?.status,
    game,
  };
}