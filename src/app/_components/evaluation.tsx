"use client";

import { useEffect, useState, useRef } from "react";

import { LineChart } from "@mui/x-charts/LineChart";

import Engine from "../../lib/engine";
import { useGameStore } from "../../lib/state/use-game-store";

export interface EvaluationProps {
  position: string;
  evaluation: number[];
}

const positionRegex = /Total evaluation\: (\-?\d+.?\d+) \([\w\s]+\)/;

export default function Evaluation({ position, evaluation }: EvaluationProps) {
  const { addEvaluation, game } = useGameStore();
  const [engine, setEngine] = useState<Engine>();
  const stockfish = useRef<Worker>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(280);

  // measure our own width - the component lives in the board-side strip now
  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const update = () => setChartWidth(element.clientWidth);

    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    /*!
     * Stockfish.js (http://github.com/nmrugg/stockfish.js)
     * License: GPL
     */
    // HACK: downloaded directly from the react-chessboard demo because I can't get it to compile
    // https://github.com/Clariity/react-chessboard/tree/main/docs/stockfish
    stockfish.current = new Worker("/engine/stockfish.wasm.js");

    if (stockfish.current !== null) {
      const newEngine = new Engine(stockfish.current);

      newEngine.onReady(() => {
        setEngine(newEngine);
      });

      newEngine.onMessage(({ uciMessage }) => {
        if (positionRegex.test(uciMessage)) {
          const data = positionRegex.exec(uciMessage);

          if (data !== null) {
            const engineEvaluation = data[1];

            addEvaluation(Number(engineEvaluation));
          }
        }
      });
    }

    return () => {
      if (stockfish.current !== null) {
        stockfish.current.terminate();
      }
    };
  }, []);

  useEffect(() => {
    if (typeof engine !== "undefined") {
      engine.stop();

      if (game.history().length > 0) {
        engine.evaluatePosition(position);
      }
    }
  }, [position]);

  return (
    <div ref={containerRef} className="flex min-w-0 flex-col">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-[#57503F]">局面评估</span>
        <span className="font-serif text-xl font-bold leading-none text-[#1F241F]">{evaluation.at(-1)}</span>
      </div>
      <div className="w-full">
        <LineChart
          series={[
            {
              type: "line",
              data: evaluation,
              area: true,
              baseline: 0,
              color: "#B0782C",
              showMark: (params) => params.index === evaluation.length - 1,
            },
          ]}
          width={chartWidth}
          height={96}
          margin={{ top: 6, bottom: 6, left: 8, right: 8 }}
          xAxis={[
            {
              data: evaluation.map((_, index) => index),
              disableLine: true,
              disableTicks: true,
            },
          ]}
          yAxis={[
            {
              min: Math.min(Math.min(...evaluation), -1) - 1,
              max: Math.max(Math.max(...evaluation), 1) + 1,
              disableLine: true,
              disableTicks: true,
            },
          ]}
        />
      </div>
    </div>
  );
}
