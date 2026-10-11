"use client";

import { useState, useRef, useEffect } from "react";
import { Chessboard } from "react-chessboard";
import { useChat } from "ai/react";
import { Mosaic } from "react-loading-indicators";
import type { Chess } from "chess.js";
import type { CustomSquareStyles, Piece, Square } from "react-chessboard/dist/chessboard/types";

import Tutor from "./tutor";
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
          content: "⚠️ Coach commentary failed (API error). Click Talk to retry.",
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
    undoMove,
    setPlayState,
    setGameOver,
    setGameOverState,
    newGame,
    autogenerateCommentary,
    setEvaluation,
  } = useGameStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  const [computerThinking, setComputerThinking] = useState(false);
  const [moveFrom, setMoveFrom] = useState<Square | null>(null);
  const [moveTo, setMoveTo] = useState<Square | null>(null);
  const [selectedPiece, setSelectedPiece] = useState<Piece | null>(null);
  const [possibleMoves, setPossibleMoves] = useState<CustomSquareStyles>({});

  // movetext without the PGN header tags (event/site/elo...) - the headers are
  // noise for the coach and leak the userAgent header to the LLM provider
  const movetextOf = (g: Chess): string =>
    g
      .pgn({ newline: " " })
      .replace(/\[[^\]]*\]\s*/g, "")
      .trim();

  // movetext plus an ASCII rendering of the board so the coach can reason
  // about the current position, not just the move history
  const positionContextOf = (g: Chess): string =>
    `Moves: ${movetextOf(g) || "(opening)"}\n\nBoard:\n${g.ascii()}`;

  const analyzeBoard = (): void => {
    stop();

    append({
      role: "user",
      content: `Please analyze the current state of the game.\n\n${positionContextOf(game)}\n\nLegal Moves: ${game.moves().join(", ")}`,
    });
  };

  const commitToMove = (): void => {
    if (game.turn() === "b") {
      stop();

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

                if (autogenerateCommentary) {
                  append({
                    content: `My opponent played ${move}.\n\n${positionContextOf(game)}`,
                    role: "user",
                  });
                }
              } catch (e) {
                console.error(e);

                const moves = game.moves({ verbose: true });

                const newMove = moves[Math.floor(Math.random() * moves.length)];

                console.log("GENERATING RANDOM MOVE: ", newMove);

                game.move(newMove);

                if (autogenerateCommentary) {
                  append({
                    content: `My opponent played ${newMove.san}.\n\n${positionContextOf(game)}`,
                    role: "user",
                  });
                }
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
          setGameOverState("Checkmate");
          append({
            content: `Checkmate.\n\n${positionContextOf(game)}`,
            role: "system",
          });
        } else if (game.isDraw()) {
          setGameOverState("Draw");
          append({
            content: `Draw.\n\n${positionContextOf(game)}`,
            role: "system",
          });
        } else if (game.isStalemate()) {
          setGameOverState("Stalemate");
          append({
            content: `Stalemate.\n\n${positionContextOf(game)}`,
            role: "system",
          });
        } else if (game.isThreefoldRepetition()) {
          setGameOverState("Ended by Repetition");
          append({
            content: `Ended by Repetition.\n\n${positionContextOf(game)}`,
            role: "system",
          });
        } else if (game.isDrawByFiftyMoves()) {
          setGameOverState("Draw by Fifty Moves Rule");
          append({
            content: `Draw by Fifty Moves Rule.\n\n${positionContextOf(game)}`,
            role: "system",
          });
        }
      }
    }
  };

  const restartGame = (): void => {
    stop();

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
    stop();

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

  const convertPieceName = (piece: Piece): string => {
    if (typeof piece === "undefined") {
      return "";
    }

    const color = piece[0] === "w" ? "white" : "black";

    let pieceName = color;

    // convert the wP to "white pawn" and bQ to "black queen", etc.
    const type = piece[1].toLowerCase();

    switch (type) {
      case "r":
        pieceName += " rook";
        break;
      case "n":
        pieceName += " knight";
        break;
      case "b":
        pieceName += " bishop";
        break;
      case "q":
        pieceName += " queen";
        break;
      case "k":
        pieceName += " king";
        break;
      case "p":
      default:
        pieceName += " pawn";
    }

    return pieceName;
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

        if (autogenerateCommentary && selectedPiece !== null && game.turn() === "w") {
          append({
            content: `I moved the ${convertPieceName(selectedPiece)} ${moveFrom} to ${square} by playing: ${game
              .history()
              .at(-1)}.\n\n${positionContextOf(game)}\n\nLegal Moves: ${game.moves().join(", ")}`,
            role: "user",
          });
        }

        setMoveFrom(null);
        setMoveTo(null);
      }
    }
  };

  const onSquareRightClick = (square: Square): void => {
    const canMove = getMoveOptions(square);

    if (canMove) {
      stop();

      const pieceInfo = game.get(square);

      if (typeof pieceInfo !== "undefined") {
        const piece = (pieceInfo?.color + pieceInfo?.type) as Piece;

        if (game.turn() === "w") {
          setMoveFrom(square);
          setSelectedPiece(piece);
          setPlayState("moving");
        }

        append({
          content: `I think ${game.turn() === "w" ? `I want to move` : `my opponent will move`} the ${convertPieceName(
            piece
          )} on ${square}${
            game.turn() === "w"
              ? `, but I'm not sure where I should put it.`
              : `, but I'm not sure where they might place it. Does moving this piece seem likely?`
          }${game.history().length === 0 ? ` This is my opening move.` : ``}\n\n${positionContextOf(game)}\n\nLegal Moves for ${square}: ${game.moves({ square, piece: pieceInfo.type }).join(", ")}`,
          role: "user",
        });
      }
    } else {
      if (game.turn() === "w") {
        setMoveFrom(null);
        setSelectedPiece(null);
        setPlayState("choosing");
      }
    }
  };

  const updateBoardWidth = (): void => {
    if (containerRef.current) {
      setBoardWidth(Math.min(containerRef.current.clientHeight, containerRef.current.clientWidth));
    }
  };

  useEffect(() => {
    updateBoardWidth();

    window.addEventListener("resize", updateBoardWidth);

    newGame();

    return () => window.removeEventListener("resize", updateBoardWidth);
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

  return (
    <>
      <div ref={containerRef} className="flex flex-col h-full w-3/4 justify-center items-center relative">
        {boardWidth > 0 && (
          <Chessboard
            arePiecesDraggable={false}
            position={game.fen()}
            onSquareRightClick={onSquareRightClick}
            onSquareClick={onSquareClick}
            customSquareStyles={{ ...lastMoveStyles, ...possibleMoves }}
            boardWidth={boardWidth}
            customBoardStyle={{
              margin: "auto",
            }}
          />
        )}
        {computerThinking && (
          <div className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-50 flex justify-center items-center">
            <Mosaic size="large" color="#31abcc" />
          </div>
        )}
        {gameOver && (
          <div className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-50 flex justify-center items-center">
            <div className="bg-white p-5 rounded-md">
              <h2 className="text-2xl">{gameOverState}</h2>
              <button onClick={restartGame} className="p-2 bg-blue-400 mt-5">
                Restart
              </button>
            </div>
          </div>
        )}
      </div>
      <aside className="flex flex-col h-screen w-1/4">
        <Tutor
          messages={messages}
          playState={playState}
          commit={commitToMove}
          undo={undo}
          analyze={analyzeBoard}
          isLoading={isLoading}
          position={game.fen()}
          turn={game.turn()}
          stop={stop}
        />
      </aside>
    </>
  );
}
