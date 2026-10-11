"use client";

import { useState, useRef, useEffect } from "react";
import { Chessboard } from "react-chessboard";
import { useChat } from "ai/react";
import { Mosaic } from "react-loading-indicators";
import type { Chess } from "chess.js";
import type { CustomSquareStyles, Piece, Square } from "react-chessboard/dist/chessboard/types";

import Tutor from "./tutor";
import Evaluation from "./evaluation";
import { useGameStore } from "../../lib/state/use-game-store";

export default function Board() {
  const { messages, append, stop, isLoading, setMessages } = useChat({
    api: "/api/bot/chat",
    // the coach route returns a plain text stream and appends a visible
    // warning itself when the analysis was truncated or timed out
    streamProtocol: "text",
    onError: (error) => {
      console.error("[coach] commentary request failed:", error);

      // surface the failure in the panel (system role renders as a notice;
      // must use setMessages - append would fire another API request)
      setMessages((current) => [
        ...current,
        {
          id: `coach-error-${Date.now()}`,
          role: "system" as const,
          content: "⚠️ 教练评论请求失败（API 错误）。在下方输入框重新发送即可重试。",
        },
      ]);
    },
    initialMessages: [
      {
        id: "tutor-welcome",
        role: "assistant",
        content: `我们一起提高棋力吧。**单击**棋子可以查看它的合法着法；**右键**点击棋子，我会为你讲解这些着法。你走棋后我会进行分析，你可以点 **Undo** 悔棋，也可以**右键**对方的棋子研究它可能的应对，想清楚后再点 **Commit** 确认落子。一旦 **Commit**，这步棋就不能撤销了。`,
      },
    ],
  });

  const {
    game,
    playState,
    gameOver,
    gameOverState,
    evaluation,
    undoMove,
    setPlayState,
    setGameOver,
    setGameOverState,
    newGame,
    setEvaluation,
  } = useGameStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  const [computerThinking, setComputerThinking] = useState(false);
  const [moveFrom, setMoveFrom] = useState<Square | null>(null);
  const [moveTo, setMoveTo] = useState<Square | null>(null);
  const [selectedPiece, setSelectedPiece] = useState<Piece | null>(null);
  const [possibleMoves, setPossibleMoves] = useState<CustomSquareStyles>({});
  const movesScrollRef = useRef<HTMLDivElement>(null);

  // coach request queue: a generation already in flight is never interrupted;
  // new messages wait here and are dispatched in order when it finishes
  const [pendingQuestions, setPendingQuestions] = useState<{ id: string; content: string }[]>([]);
  const inFlightRef = useRef(false);
  const [drainTick, setDrainTick] = useState(0);

  // movetext without the PGN header tags (event/site/elo...) - the headers are
  // noise for the coach and leak the userAgent header to the LLM provider
  const movetextOf = (g: Chess): string =>
    g
      .pgn({ newline: " " })
      .replace(/\[[^\]]*\]\s*/g, "")
      .trim();

  // movetext plus an ASCII rendering of the board so the coach can reason
  // about the current position, not just the move history; the round stamp
  // makes snapshot ordering explicit in a multi-turn conversation
  const positionContextOf = (g: Chess): string =>
    `[Position snapshot 局面快照 · 第 ${Math.ceil(g.history().length / 2)} 回合后]\nMoves: ${movetextOf(g) || "(opening)"}\nBoard:\n${g.ascii()}`;

  const submitToCoach = (content: string): void => {
    if (inFlightRef.current) {
      setPendingQuestions((current) => [
        ...current,
        { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, content },
      ]);
      return;
    }

    inFlightRef.current = true;

    append({ role: "user", content })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current = false;
        setDrainTick((tick) => tick + 1);
      });
  };

  // dispatch the next queued message once nothing is in flight
  useEffect(() => {
    if (inFlightRef.current || pendingQuestions.length === 0) {
      return;
    }

    const [next, ...rest] = pendingQuestions;

    setPendingQuestions(rest);
    submitToCoach(next.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestions, isLoading, drainTick]);

  // free-form question to the coach: the player's text plus the current
  // position context, so the question is self-contained even though the
  // full history is also sent for follow-up reasoning
  const askCoach = (text: string): void => {
    submitToCoach(`${text}\n\n${positionContextOf(game)}\n\nLegal Moves: ${game.moves().join(", ")}`);
  };

  const commitToMove = (): void => {
    if (game.turn() === "b") {
      setMoveFrom(null);
      setMoveTo(null);
      setSelectedPiece(null);
      setPossibleMoves({});
      setPlayState("committed");

      if (!game.isGameOver()) {
        if (game.turn() === "b") {
          setComputerThinking(true);

          fetch("/api/bot/reason", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              position: movetextOf(game),
              legalMoves: game.moves(),
              board: game.ascii(),
            }),
          })
            .then(async (response) => {
              if (response.ok) {
                return response.json();
              }
            })
            .then(({ move }) => {
              console.log("MOVE: ", move);

              try {
                game.move(move);

                // automatic commentary on the full round (queues if another
                // generation is still in flight); the opponent's reply is
                // last, the player's move second-to-last
                const history = game.history();
                const myMove = history.at(-2) ?? "？";
                submitToCoach(`我走了 ${myMove}，对手回了 ${move}。\n\n${positionContextOf(game)}\n\nLegal Moves: ${game.moves().join(", ")}`);
              } catch (e) {
                console.error(e);

                const moves = game.moves({ verbose: true });

                const newMove = moves[Math.floor(Math.random() * moves.length)];

                console.log("GENERATING RANDOM MOVE: ", newMove);

                game.move(newMove);

                const history = game.history();
                const myMove = history.at(-2) ?? "？";
                submitToCoach(`我走了 ${myMove}，对手回了 ${newMove.san}。\n\n${positionContextOf(game)}\n\nLegal Moves: ${game.moves().join(", ")}`);
              }
            })
            .catch((e) => {
              console.error(e);
            })
            .finally(() => {
              setComputerThinking(false);
            });
        }
      } else {
        setGameOver(true);

        if (game.isCheckmate()) {
          setGameOverState("将死");
          append({
            content: `将死。\n\n${positionContextOf(game)}`,
            role: "system",
          });
        } else if (game.isDraw()) {
          setGameOverState("和棋");
          append({
            content: `和棋。\n\n${positionContextOf(game)}`,
            role: "system",
          });
        } else if (game.isStalemate()) {
          setGameOverState("逼和");
          append({
            content: `逼和。\n\n${positionContextOf(game)}`,
            role: "system",
          });
        } else if (game.isThreefoldRepetition()) {
          setGameOverState("三次重复和棋");
          append({
            content: `三次重复和棋。\n\n${positionContextOf(game)}`,
            role: "system",
          });
        } else if (game.isDrawByFiftyMoves()) {
          setGameOverState("五十回合规则和棋");
          append({
            content: `五十回合规则和棋。\n\n${positionContextOf(game)}`,
            role: "system",
          });
        }
      }
    }
  };

  const restartGame = (): void => {
    // a new game drops any in-flight generation and queued messages
    stop();
    setPendingQuestions([]);

    newGame();
    setEvaluation([0.0]);

    setMessages([
      {
        id: "tutor-welcome",
        role: "assistant",
        content: `我们一起提高棋力吧。**单击**棋子可以查看它的合法着法；**右键**点击棋子，我会为你讲解这些着法。你走棋后我会进行分析，你可以点 **Undo** 悔棋，也可以**右键**对方的棋子研究它可能的应对，想清楚后再点 **Commit** 确认落子。一旦 **Commit**，这步棋就不能撤销了。`,
      },
    ]);

    setMoveFrom(null);
    setMoveTo(null);
    setSelectedPiece(null);
    setPossibleMoves({});
  };

  const undo = (): void => {
    undoMove();

    setMoveFrom(null);
    setMoveTo(null);
    setSelectedPiece(null);
    setPossibleMoves({});
  };

  const getMoveOptions = (square: Square): boolean => {
    const moves = game.moves({
      square,
      verbose: true,
    });

    if (moves.length === 0) {
      setPossibleMoves({});
      return false;
    }

    const newSquares: CustomSquareStyles = {};

    moves.forEach((move) => {
      newSquares[move.to] = {
        background:
          game.get(move.to) && game.get(move.to)?.color !== game.get(square)?.color
            ? "radial-gradient(circle, rgba(0,0,0,.1) 85%, transparent 85%)"
            : "radial-gradient(circle, rgba(0,0,0,.1) 25%, transparent 25%)",
        borderRadius: "50%",
      };
    });

    newSquares[square] = {
      background: "rgba(255, 255, 0, 0.4)",
    };

    setPossibleMoves(newSquares);

    return true;
  };

  // converts wP -> "白兵", bQ -> "黑后", etc. for the coach prompts
  const convertPieceName = (piece: Piece): string => {
    if (typeof piece === "undefined") {
      return "";
    }

    const color = piece[0] === "w" ? "白" : "黑";

    const type = piece[1].toLowerCase();

    switch (type) {
      case "r":
        return `${color}车`;
      case "n":
        return `${color}马`;
      case "b":
        return `${color}象`;
      case "q":
        return `${color}后`;
      case "k":
        return `${color}王`;
      case "p":
      default:
        return `${color}兵`;
    }
  };

  const onSquareClick = (square: Square, piece?: Piece): void => {
    if (moveFrom === null) {
      // the player controls white on their turn only - left-clicking
      // opponent pieces must never move them (right-click inspects instead)
      const pieceInfo = game.get(square);

      if (game.turn() !== "w" || pieceInfo?.color !== "w") {
        setPlayState("choosing");
        return;
      }

      const canMove = getMoveOptions(square);

      if (canMove) {
        setMoveFrom(square);
        setSelectedPiece(piece ?? null);
        setPlayState("moving");
      } else {
        setPlayState("choosing");
      }
    } else if (moveTo === null) {
      // clicking the selected piece again deselects it
      if (square === moveFrom) {
        setMoveFrom(null);
        setSelectedPiece(null);
        setPossibleMoves({});
        setPlayState("choosing");
        return;
      }

      const moves = game.moves({ square: moveFrom, verbose: true });

      const isValidMove = moves.find((move) => move.from === moveFrom && move.to === square);

      if (!isValidMove) {
        const canMove = getMoveOptions(square);

        setMoveFrom(canMove ? square : null);
        setSelectedPiece(canMove ? piece ?? null : null);
        setPlayState(canMove ? "moving" : "choosing");
      } else {
        setMoveTo(square);
        setPlayState("moved");
        setPossibleMoves({});

        game.move({ from: moveFrom, to: square });

        setMoveFrom(null);
        setMoveTo(null);
      }
    }
  };

  const onSquareRightClick = (square: Square): void => {
    const canMove = getMoveOptions(square);

    if (canMove) {
      const pieceInfo = game.get(square);

      if (typeof pieceInfo !== "undefined") {
        const piece = (pieceInfo?.color + pieceInfo?.type) as Piece;

        if (game.turn() === "w") {
          setMoveFrom(square);
          setSelectedPiece(piece);
          setPlayState("moving");
        }

        submitToCoach(`${game.turn() === "w" ? `我想走 ${square} 上的${convertPieceName(piece)}，但不确定放到哪里好。` : `对手可能会走 ${square} 上的${convertPieceName(piece)}，这步可能性大吗？`}${game.history().length === 0 ? `这是我的开局第一步。` : ``}\n\n${positionContextOf(game)}\n\nLegal Moves for ${square}: ${game.moves({ square, piece: pieceInfo.type }).join(", ")}`);
      }
    } else {
      if (game.turn() === "w") {
        setMoveFrom(null);
        setSelectedPiece(null);
        setPlayState("choosing");
      }
    }
  };

  // size the board from its actual available box (not just the window):
  // the sibling strip grows/shrinks (move list appears, etc.) and a
  // window-only listener would leave the board overflowing the container
  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const update = () => setBoardWidth(Math.min(element.clientHeight, element.clientWidth));

    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);

    newGame();

    return () => observer.disconnect();
  }, []);

  // stopping an in-flight commentary stream (commit/undo/Talk) can leave an
  // assistant message with no content once the stream settles - drop those
  useEffect(() => {
    if (isLoading) {
      return;
    }

    setMessages((current) => {
      const filtered = current.filter((message) => !(message.role === "assistant" && message.content === ""));

      return filtered.length === current.length ? current : filtered;
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const lastMove = game.history({ verbose: true }).at(-1);

  const lastMoveStyles: CustomSquareStyles = lastMove
    ? {
        [lastMove.from]: { background: "rgba(255, 213, 79, 0.45)" },
        [lastMove.to]: { background: "rgba(255, 213, 79, 0.55)" },
      }
    : {};

  const turnStatus = gameOver
    ? "对局结束"
    : computerThinking
      ? "对手思考中…"
      : game.turn() === "w"
        ? "轮到你走棋（白方）"
        : "走子待确认：Undo 或 Commit";

  const actionButtonsDisabled = gameOver || game.turn() === "w";

  // game record in scoresheet form: pairs of white/black moves
  const moveHistory = game.history();
  const movePairs: { n: number; w: string; b?: string }[] = [];

  for (let i = 0; i < moveHistory.length; i += 2) {
    movePairs.push({ n: i / 2 + 1, w: moveHistory[i], b: moveHistory[i + 1] });
  }

  // keep the scoresheet scrolled to the latest move
  useEffect(() => {
    if (movesScrollRef.current) {
      movesScrollRef.current.scrollTop = movesScrollRef.current.scrollHeight;
    }
  }, [moveHistory.length]);

  return (
    <>
      <section ref={containerRef} className="relative flex h-full min-w-0 flex-1 items-start justify-center">
        {boardWidth > 0 && (
          <Chessboard
            arePiecesDraggable={false}
            position={game.fen()}
            onSquareRightClick={onSquareRightClick}
            onSquareClick={onSquareClick}
            customSquareStyles={{ ...lastMoveStyles, ...possibleMoves }}
            boardWidth={boardWidth}
            customBoardStyle={{
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 18px 48px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35)",
            }}
          />
        )}

        {computerThinking && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
            <Mosaic size="large" color="#F2EDE0" />
          </div>
        )}
        {gameOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="paper rounded-xl border border-[#D8D0BC] p-8 text-center shadow-2xl">
              <h2 className="font-serif text-2xl font-bold text-[#1F241F]">{gameOverState}</h2>
              <button
                onClick={restartGame}
                className="mt-5 cursor-pointer rounded-lg bg-[#2F5A47] px-6 py-2 font-medium text-[#F2EDE0] shadow-sm transition-colors hover:bg-[#24483A]"
              >
                再来一局
              </button>
            </div>
          </div>
        )}
      </section>

      {/* scoresheet rail: evaluation on top, move record, actions at the
          bottom within easy reach (like the chat input) */}
      <aside
        style={{ height: boardWidth > 0 ? boardWidth : undefined }}
        className="paper flex min-h-[520px] w-[210px] shrink-0 flex-col gap-4 rounded-xl border border-[#D8D0BC] p-4 text-[#1F241F] shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
      >
        <div className="border-b border-[#E2DAC6] pb-3">
          <Evaluation evaluation={evaluation} position={game.fen()} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-1 grid grid-cols-[1.6rem_1fr_1fr] gap-1 text-[10px] font-medium text-[#57503F]">
            <span>#</span>
            <span className="text-center">白（你）</span>
            <span className="text-center">黑（对手）</span>
          </div>
          <div ref={movesScrollRef} className="min-h-0 flex-1 overflow-y-auto font-mono text-xs leading-6">
            {movePairs.length === 0 ? (
              <span className="font-sans text-[#8A8271]">对局尚未开始</span>
            ) : (
              movePairs.map((pair, index) => (
                <div
                  key={pair.n}
                  className={`grid grid-cols-[1.6rem_1fr_1fr] items-center gap-1 rounded px-1 ${
                    index === movePairs.length - 1 ? "bg-[#F0E4C8]" : ""
                  }`}
                >
                  <span className="text-[#8A8271]">{pair.n}.</span>
                  <span className="rounded border border-[#E2DAC6] bg-white px-1.5 py-0.5 text-center text-[#1F241F]">
                    {pair.w}
                  </span>
                  {pair.b ? (
                    <span className="rounded bg-[#3A362C] px-1.5 py-0.5 text-center text-[#F2EDE0]">{pair.b}</span>
                  ) : (
                    <span />
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-[#E2DAC6] pt-3">
          <p className="text-center text-xs font-medium text-[#57503F]">{turnStatus}</p>
          <button
            disabled={actionButtonsDisabled}
            onClick={commitToMove}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-[#F2EDE0] shadow-sm transition-colors ${
              actionButtonsDisabled
                ? "cursor-not-allowed bg-[#C9C0AA] text-[#8A8271]"
                : "cursor-pointer bg-[#B3402A] hover:bg-[#993621]"
            }`}
          >
            Commit
          </button>
          <button
            disabled={actionButtonsDisabled}
            onClick={undo}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              actionButtonsDisabled
                ? "cursor-not-allowed border-[#DDD5C2] text-[#B0A88F]"
                : "cursor-pointer border-[#C9C0AA] bg-transparent text-[#3A362C] hover:bg-[#E7E0CE]"
            }`}
          >
            Undo
          </button>
        </div>
      </aside>

      <aside
        data-panel="chat"
        style={{ height: boardWidth > 0 ? boardWidth : undefined }}
        className="flex min-h-[520px] w-[360px] shrink-0 flex-col xl:w-[420px]"
      >
        <Tutor
          messages={messages}
          send={askCoach}
          isLoading={isLoading}
          pending={pendingQuestions}
        />
      </aside>
    </>
  );
}
