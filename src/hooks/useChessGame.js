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

function recordUpdatedAtMs(record) {
  if (!record?.updated_date) return 0;
  const value = record.updated_date;
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  const parsed = new Date(hasTz ? value : `${value}Z`).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// Manages loading/creating the Game entity for a match, hydrating the board,
// and submitting moves to the submitMove backend function (the sole authority
// over FEN, PGN, status, result, and winner_id).
export function useChessGame(matchId, userId, active) {
  const [fen, setFen] = useState(START_FEN);
  const [game, setGame] = useState(null);
  const pendingMoveRef = useRef(null);
  const [syncMessage, setSyncMessage] = useState("");
  const activeMatchRef = useRef(matchId);
  activeMatchRef.current = matchId;
  const [color, setColor] = useState("white");
  const chessRef = useRef(new Chess());
  // Ply of the position currently rendered — the single source of truth for
  // ordering. Never let a lower-ply update overwrite it.
  const renderedPlyRef = useRef(0);
  const renderedUpdatedAtRef = useRef(0);
  const renderedStatusRef = useRef(null);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [legalTargets, setLegalTargets] = useState([]);
  const selectedSquareRef = useRef(null);
  const legalTargetsRef = useRef([]);
  const selectionInputRef = useRef(null);
  const { toast } = useToast();

  const clearSelection = useCallback(() => {
    selectedSquareRef.current = null;
    legalTargetsRef.current = [];
    selectionInputRef.current = null;
    setSelectedSquare(null);
    setLegalTargets([]);
  }, []);

  const selectSquare = useCallback((square, targets, inputMeta = {}) => {
    selectedSquareRef.current = square;
    legalTargetsRef.current = targets;
    selectionInputRef.current = {
      selectedAt: Date.now(),
      pointerType: inputMeta.pointerType || "unknown",
      repeatedSourceTaps: 0,
    };
    setSelectedSquare(square);
    setLegalTargets(targets);
  }, []);

  const applyLatest = useCallback((latest) => {
      if (!latest?.fen || latest.match_id !== activeMatchRef.current) return false;
      // Reject any state that is behind what's already rendered — this is what
      // stops a delayed/in-flight poll or subscription event from ever
      // rolling the board back to an earlier position.
      const latestPly = plyFromFen(latest.fen);
      const latestUpdatedAt = recordUpdatedAtMs(latest);
      if (latestPly < renderedPlyRef.current) return;
      if (latestPly === renderedPlyRef.current && latestUpdatedAt < renderedUpdatedAtRef.current) return;
      if (renderedStatusRef.current === "completed" && latest.status !== "completed") return;
      const positionChanged = latest.fen !== chessRef.current.fen();
      const gameEnded = latest.status === "completed";
      if (positionChanged) {
        chessRef.current.load(latest.fen);
        setFen(chessRef.current.fen());
      }
      renderedPlyRef.current = latestPly;
      renderedUpdatedAtRef.current = Math.max(renderedUpdatedAtRef.current, latestUpdatedAt);
      renderedStatusRef.current = latest.status;
      setGame(latest);
      if (pendingMoveRef.current && (latestPly > pendingMoveRef.current.ply || gameEnded)) {
        pendingMoveRef.current = null;
        setSyncMessage("");
      }

      // Keep a valid click-to-move selection across same-position refreshes.
      // Realtime may emit metadata-only Game updates and the recovery poll
      // fetches the same record every five seconds; neither changes legal
      // moves, so clearing here made the highlights appear to vanish at
      // random. A genuine position change (opponent move, reconnect to a newer
      // position, or server correction) or game completion still clears it.
      if (positionChanged || gameEnded) {
        clearSelection();
      }
      return true;
  }, [clearSelection]);

  useEffect(() => {
    pendingMoveRef.current = null;
    setSyncMessage("");
    renderedPlyRef.current = 0;
    renderedUpdatedAtRef.current = 0;
    renderedStatusRef.current = null;
    chessRef.current = new Chess();
    setFen(START_FEN);
    setGame(null);
    clearSelection();
  }, [matchId, clearSelection]);

  const loadGame = useCallback(async () => {
    if (!matchId || !userId) return;
    const match = await base44.entities.Match.get(matchId);
    setColor(match.player1_id === userId ? "white" : "black");

    // getOrCreateGame is the single authoritative, idempotent source for the
    // Match's Game — both players calling this concurrently always converge
    // on the same Game id, eliminating the prior client-side race where each
    // player could independently create their own Game record.
    const { data } = await base44.functions.invoke("getOrCreateGame", { matchId });
    if (activeMatchRef.current !== matchId) return;
    applyLatest(data.game);
  }, [matchId, userId, applyLatest]);

  useEffect(() => {
    if (!active) {
      // Clear any previous match's game data so a dismissed/completed game can
      // never bleed into the next match's initial render.
      pendingMoveRef.current = null;
      setSyncMessage("");
      setGame(null);
      setFen(START_FEN);
      chessRef.current = new Chess();
      renderedPlyRef.current = 0;
      renderedUpdatedAtRef.current = 0;
      renderedStatusRef.current = null;
      clearSelection();
      return;
    }

    // A refresh during a network interruption previously made one bootstrap
    // attempt and then stayed blank forever. Retry until the authoritative
    // Match/Game can be loaded, with online/focus events prompting an immediate
    // recovery instead of requiring the player to refresh again.
    let stopped = false;
    let inFlight = false;
    let loaded = false;
    let retryTimer = null;
    const recover = async () => {
      if (stopped || inFlight || loaded) return;
      inFlight = true;
      try {
        await loadGame();
        if (!stopped) loaded = true;
      } catch {
        if (!stopped) retryTimer = window.setTimeout(recover, 3000);
      } finally {
        inFlight = false;
      }
    };
    const recoverNow = () => {
      if (stopped || loaded) return;
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = null;
      void recover();
    };
    void recover();
    window.addEventListener("online", recoverNow);
    window.addEventListener("focus", recoverNow);
    return () => {
      stopped = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener("online", recoverNow);
      window.removeEventListener("focus", recoverNow);
    };
  }, [active, loadGame, clearSelection]);

  // Server-authoritative presence heartbeat, for disconnect/reconnect
  // detection only. Never affects clocks, moves, or outcomes â€” see
  // gameHeartbeat backend function.
  useEffect(() => {
    if (!active || !game?.id || game.status === "completed") return;
    const HEARTBEAT_INTERVAL_MS = 8000;
    const sendHeartbeat = () => {
      base44.functions.invoke("gameHeartbeat", { gameId: game.id }).catch(() => {});
    };
    sendHeartbeat();
    const heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(heartbeatInterval);
  }, [active, game?.id, game?.status]);

  // Browser visibility telemetry supplements the server move/clock record. It
  // is intentionally not enforcement logic: the backend only stores it for
  // later human review, and duplicate browser events are de-duplicated there.
  useEffect(() => {
    if (!active || !game?.id || game.status === "completed") return;

    const report = (eventType) => {
      base44.functions.invoke("recordGameFocusEvent", { gameId: game.id, eventType }).catch(() => {});
    };
    const onVisibilityChange = () => report(document.hidden ? "hidden" : "visible");
    const onBlur = () => report("blur");
    const onFocus = () => report("focus");

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [active, game?.id, game?.status]);

  useEffect(() => {
    if (!active || !game?.id) return;



    // Recover the authoritative state immediately on (re)subscribe, e.g. after a
    // browser refresh or a dropped realtime connection being re-established.
    let stopped = false;
    base44.entities.Game.get(game.id).then(latest => { if (!stopped) applyLatest(latest); }).catch(() => {});

    const unsubscribe = base44.entities.Game.subscribe((event) => {
      if (stopped || event.data?.id !== game.id) return;
      if (event.type === "update" || event.type === "create") {
        applyLatest(event.data);
      }
    });

    // Realtime remains the primary path. The visible-tab safety poll recovers
    // silently dropped websocket updates, while background tabs avoid repeated
    // reads and perform an immediate authoritative refresh on return.
    let recoveryInFlight = false;
    const recoverLatest = async () => {
      if (document.visibilityState !== "visible" || recoveryInFlight) return;
      recoveryInFlight = true;
      try {
        const latest = await base44.entities.Game.get(game.id);
        if (!stopped) {
          const applied = applyLatest(latest);
          if (applied && pendingMoveRef.current?.uncertain) {
            pendingMoveRef.current = null;
            setSyncMessage("");
          }
        }
      } catch {
        // The next realtime event or visible recovery interval will retry.
      } finally {
        recoveryInFlight = false;
      }
    };
    const pollInterval = setInterval(recoverLatest, 5000);
    document.addEventListener("visibilitychange", recoverLatest);
    window.addEventListener("focus", recoverLatest);
    window.addEventListener("online", recoverLatest);

    return () => {
      stopped = true;
      unsubscribe();
      clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", recoverLatest);
      window.removeEventListener("focus", recoverLatest);
      window.removeEventListener("online", recoverLatest);
    };
  }, [active, game?.id, clearSelection, applyLatest]);

  // Shared core used by both Drag & Drop (handleDrop) and Click to Move
  // (handleSquareClick) — the single path that ever calls submitMove, so both
  // input methods run through identical validation/optimistic-update/rollback logic.
  const attemptMove = useCallback(
    (sourceSquare, targetSquare, inputMeta = {}) => {
      if (!game || game.status === "completed" || pendingMoveRef.current) return false;

      // Only the player whose turn it is may initiate a move. This keeps
      // click and drag input aligned with server authority and prevents legal
      // targets for the opponent's pieces from appearing locally.
      const playerColor = color === "white" ? "w" : "b";
      const currentPosition = chessRef.current;
      const sourcePiece = currentPosition.get(sourceSquare);
      if (currentPosition.turn() !== playerColor || sourcePiece?.color !== playerColor) return false;

      // Quick client-side legality check purely for instant snap-back UX.
      // The server remains the sole authority over the persisted game state.
      const preview = new Chess(currentPosition.fen());
      let previewMove;
      try {
        previewMove = preview.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      } catch (e) {
        previewMove = null;
      }
      if (!previewMove) return false;

      const previousFen = chessRef.current.fen();

      // Keep the confirmed board and turn until the server accepts the move.
      const operation = { gameId: game.id, ply: plyFromFen(previousFen) };
      pendingMoveRef.current = operation;
      setSyncMessage("Confirming move…");
      clearSelection();

      // Sanitized, aggregate-only input telemetry helps detect mobile
      // interaction regressions without recording game IDs, squares, moves,
      // player IDs, or any other gameplay content.
      if (inputMeta.inputMode === "click") {
        try {
          Promise.resolve(
            base44.analytics.track({
              eventName: "game_move_input_completed",
              properties: {
                input_mode: "click",
                pointer_type: inputMeta.pointerType || "unknown",
                selection_latency_ms: Math.max(0, Math.min(60000, Number(inputMeta.selectionLatencyMs) || 0)),
                repeated_source_taps: Math.max(0, Math.min(10, Number(inputMeta.repeatedSourceTaps) || 0)),
              },
            })
          ).catch(() => {});
        } catch {
          // Analytics must never interrupt a chess move.
        }
      }

      (async () => {
        let deadline;
        try {
          // Never resubmit automatically: a lost response may still have committed.
          const response = await Promise.race([
            base44.functions.invoke("submitMove", {
              gameId: game.id, from: sourceSquare, to: targetSquare,
              promotion: "q", expectedFen: previousFen,
            }),
            new Promise((_, reject) => {
              deadline = setTimeout(() => reject(new Error("Move confirmation interrupted")), 15000);
            }),
          ]);
          if (activeMatchRef.current !== matchId) return;
          if (response?.data?.game) applyLatest(response.data.game);
          if (pendingMoveRef.current === operation) pendingMoveRef.current = null;
          setSyncMessage("");
        } catch (error) {
          if (activeMatchRef.current !== matchId || pendingMoveRef.current !== operation) return;
          operation.uncertain = true;
          setSyncMessage("Reconnecting — checking your move…");
          try {
            const latest = await base44.entities.Game.get(game.id);
            if (activeMatchRef.current !== matchId || pendingMoveRef.current !== operation) return;
            applyLatest(latest);
            if (pendingMoveRef.current === operation) pendingMoveRef.current = null;
            setSyncMessage("");
            if (plyFromFen(latest.fen) === operation.ply && latest.status !== "completed") {
              toast({
                title: "Move not confirmed",
                description: "The confirmed position has been restored. Check whose turn it is before trying again.",
              });
            }
          } catch {
            // Keep input blocked until a later authoritative update proves the
            // outcome. A read failure must never roll back a confirmed position.
            setSyncMessage("Reconnecting — waiting to confirm your move. Please keep this game open.");
          }
        } finally {
          clearTimeout(deadline);
        }
      })();

      return true;
    },
    [game, color, toast, clearSelection, matchId, applyLatest]
  );

  const handleDrop = useCallback(
    (sourceSquare, targetSquare) => attemptMove(sourceSquare, targetSquare),
    [attemptMove]
  );

  // Click to Move: tap a legal piece to select it and tap a highlighted
  // destination to move. Repeated source taps intentionally keep the piece
  // selected; this makes impatient/rage taps harmless instead of alternating
  // the legal-move highlights on and off.
  const handleSquareClick = useCallback(
    (square, inputMeta = {}) => {
      if (!game || game.status === "completed") return;
      const chess = chessRef.current;
      const turn = chess.turn();
      const playerColor = color === "white" ? "w" : "b";

      if (turn !== playerColor) {
        clearSelection();
        return;
      }

      const currentSelected = selectedSquareRef.current;
      const currentTargets = legalTargetsRef.current;

      if (currentSelected) {
        if (square === currentSelected) {
          if (selectionInputRef.current) {
            selectionInputRef.current.repeatedSourceTaps += 1;
          }
          return;
        }

        if (currentTargets.includes(square)) {
          const selectionInput = selectionInputRef.current;
          attemptMove(currentSelected, square, {
            inputMode: "click",
            pointerType: inputMeta.pointerType || selectionInput?.pointerType || "unknown",
            selectionLatencyMs: selectionInput ? Date.now() - selectionInput.selectedAt : 0,
            repeatedSourceTaps: selectionInput?.repeatedSourceTaps || 0,
          });
          return;
        }

        const piece = chess.get(square);
        if (piece && piece.color === turn) {
          const moves = chess.moves({ square, verbose: true });
          if (moves.length > 0) {
            selectSquare(square, moves.map((move) => move.to), inputMeta);
          } else {
            clearSelection();
          }
        } else {
          clearSelection();
        }
        return;
      }

      const piece = chess.get(square);
      if (piece && piece.color === turn) {
        const moves = chess.moves({ square, verbose: true });
        if (moves.length > 0) {
          selectSquare(square, moves.map((move) => move.to), inputMeta);
        }
      }
    },
    [game, color, attemptMove, clearSelection, selectSquare]
  );

  return {
    fen,
    syncMessage,
    handleDrop,
    handleSquareClick,
    selectedSquare,
    legalTargets,
    orientation: color,
    gameStatus: game?.status,
    game,
  };
}