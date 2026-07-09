import { useState, useEffect, useCallback, useRef } from "react";
import { Chess } from "chess.js";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Starting clock time and increment per ChessBet time control.
const TIME_CONTROLS = {
  blitz: { initialMs: 3 * 60 * 1000, incrementMs: 2 * 1000 },
  rapid: { initialMs: 10 * 60 * 1000, incrementMs: 0 },
  classical: { initialMs: 15 * 60 * 1000, incrementMs: 10 * 1000 },
};

// Manages loading/creating the Game entity for a match, hydrating the board,
// and submitting moves to the submitMove backend function (the sole authority
// over FEN, PGN, status, result, and winner_id).
export function useChessGame(matchId, userId, active) {
  const [fen, setFen] = useState(START_FEN);
  const [game, setGame] = useState(null);
  const [color, setColor] = useState("white");
  const chessRef = useRef(new Chess());
  const { toast } = useToast();

  const loadGame = useCallback(async () => {
    if (!matchId || !userId) return;
    const match = await base44.entities.Match.get(matchId);
    setColor(match.player1_id === userId ? "white" : "black");

    let g = null;
    if (match.game_id) {
      g = await base44.entities.Game.get(match.game_id);
    } else {
      const existing = await base44.entities.Game.filter({ match_id: matchId }, "-created_date", 1);
      if (existing.length > 0) {
        g = existing[0];
      } else {
        const tc = TIME_CONTROLS[match.time_control] || TIME_CONTROLS.rapid;
        g = await base44.entities.Game.create({
          match_id: matchId,
          status: "active",
          fen: START_FEN,
          pgn: "",
          result: "unfinished",
          white_time_ms: tc.initialMs,
          black_time_ms: tc.initialMs,
          increment_ms: tc.incrementMs,
          turn_started_at: new Date().toISOString(),
        });
        await base44.entities.Match.update(matchId, { game_id: g.id });
      }
    }
    setGame(g);
    chessRef.current.load(g.fen || START_FEN);
    setFen(chessRef.current.fen());
  }, [matchId, userId]);

  useEffect(() => {
    if (!active) {
      // Clear any previous match's game data so a dismissed/completed game can
      // never bleed into the next match's initial render.
      setGame(null);
      setFen(START_FEN);
      chessRef.current = new Chess();
      return;
    }
    loadGame();
  }, [active, loadGame]);

  useEffect(() => {
    if (!active || !game?.id) return;

    const applyLatest = (latest) => {
      if (latest.fen !== chessRef.current.fen()) {
        chessRef.current.load(latest.fen);
        setFen(chessRef.current.fen());
      }
      setGame(latest);
    };

    // Recover the authoritative state immediately on (re)subscribe, e.g. after a
    // browser refresh or a dropped realtime connection being re-established.
    base44.entities.Game.get(game.id).then(applyLatest);

    const unsubscribe = base44.entities.Game.subscribe((event) => {
      if (event.data?.id !== game.id) return;
      if (event.type === "update" || event.type === "create") {
        applyLatest(event.data);
      }
    });

    return () => unsubscribe();
  }, [active, game?.id]);

  const handleDrop = useCallback(
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

  return { fen, handleDrop, orientation: color, gameStatus: game?.status, game };
}