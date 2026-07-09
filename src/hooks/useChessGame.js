import { useState, useEffect, useCallback, useRef } from "react";
import { Chess } from "chess.js";
import { base44 } from "@/api/base44Client";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Manages loading/creating the Game entity for a match, hydrating the board,
// enforcing turns, persisting moves, and detecting game completion.
export function useChessGame(matchId, userId, active) {
  const [fen, setFen] = useState(START_FEN);
  const [game, setGame] = useState(null);
  const [color, setColor] = useState("white");
  const chessRef = useRef(new Chess());

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
        g = await base44.entities.Game.create({
          match_id: matchId,
          status: "active",
          fen: START_FEN,
          pgn: "",
          result: "unfinished",
        });
        await base44.entities.Match.update(matchId, { game_id: g.id });
      }
    }
    setGame(g);
    chessRef.current.load(g.fen || START_FEN);
    setFen(chessRef.current.fen());
  }, [matchId, userId]);

  useEffect(() => {
    if (!active) return;
    loadGame();
  }, [active, loadGame]);

  useEffect(() => {
    if (!active || !game?.id) return;
    const poll = setInterval(async () => {
      const latest = await base44.entities.Game.get(game.id);
      if (latest.fen !== chessRef.current.fen()) {
        chessRef.current.load(latest.fen);
        setFen(chessRef.current.fen());
      }
      setGame(latest);
    }, 4000);
    return () => clearInterval(poll);
  }, [active, game?.id]);

  const handleDrop = useCallback(
    (sourceSquare, targetSquare) => {
      if (!game || game.status === "completed") return false;
      const isMyTurn = chessRef.current.turn() === (color === "white" ? "w" : "b");
      if (!isMyTurn) return false;

      let move;
      try {
        move = chessRef.current.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      } catch (e) {
        return false;
      }
      if (!move) return false;

      const newFen = chessRef.current.fen();
      const newPgn = chessRef.current.pgn();
      setFen(newFen);

      const updates = { fen: newFen, pgn: newPgn };
      if (!game.started_at) {
        updates.started_at = new Date().toISOString();
      }

      if (chessRef.current.isGameOver()) {
        updates.status = "completed";
        updates.completed_at = new Date().toISOString();
        if (chessRef.current.isCheckmate()) {
          updates.result = move.color === "w" ? "white_win" : "black_win";
        } else {
          updates.result = "draw";
        }
      }

      (async () => {
        const match = await base44.entities.Match.get(matchId);
        if (updates.result === "white_win") {
          updates.winner_id = match.player1_id;
        } else if (updates.result === "black_win") {
          updates.winner_id = match.player2_id;
        }
        const updated = await base44.entities.Game.update(game.id, updates);
        setGame(updated);
      })();

      return true;
    },
    [game, color, matchId]
  );

  return { fen, handleDrop, orientation: color, gameStatus: game?.status };
}