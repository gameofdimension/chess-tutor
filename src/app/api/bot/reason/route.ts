import { CoreMessage, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { OPPONENT_REASONING_PROMPT } from "../../../../lib/prompts";
import { API_CONFIG, OPPONENT_MODEL } from "../../../../lib/config";

export async function POST(req: Request) {
  const { position, legalMoves, board } = await req.json();

  const openai = createOpenAI(API_CONFIG);

  const messages: CoreMessage[] = [
    {
      role: "user",
      content: position,
    },
  ];

  if (typeof legalMoves !== "undefined") {
    messages.push({
      role: "user",
      content: `Legal Moves: ${legalMoves.join(", ")}`,
    });
  }

  if (typeof board !== "undefined") {
    messages.push({
      role: "user",
      content: `Board State: ${board}`,
    });
  }

  const requestMove = () =>
    generateText({
      model: openai.chat(OPPONENT_MODEL, {
        // deepseek-flash thinks by default; "low" is enough for picking a move
        // from the legal-move list and keeps latency/cost down
        reasoningEffort: "low",
      }),
      system: OPPONENT_REASONING_PROMPT,
      messages,
      temperature: 0.57,
      // reasoning models spend tokens on thinking before the visible move,
      // so this needs enough headroom for both (a bare move is ~2 tokens)
      maxTokens: 2048,
    });

  // the model occasionally returns empty content (all budget spent thinking);
  // retry once before falling back to the client's random move
  let results = await requestMove();
  if (!results.text.trim()) {
    results = await requestMove();
  }

  let move = results.text.trim();

  if (move.includes(".")) {
    move = move.replace(/\./g, "").trim();
  }

  if (move.includes(" ")) {
    move = move.split(" ").at(-1) ?? move;
  }

  return Response.json({ move });
}
