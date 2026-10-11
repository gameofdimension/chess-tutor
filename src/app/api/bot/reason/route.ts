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

  const requestMove = (attempt: number) => {
    const startedAt = Date.now();
    return generateText({
      model: openai.chat(OPPONENT_MODEL, {
        // DeepSeek supports reasoning_effort "none" (no thinking phase);
        // picking a move from an explicit legal-move list doesn't need it
        // and it cuts latency from seconds to under a second. The SDK's
        // type only lists low/medium/high, hence the cast.
        reasoningEffort: "none" as "low",
      }),
      system: OPPONENT_REASONING_PROMPT,
      messages,
      temperature: 0.57,
      // reasoning models spend tokens on thinking before the visible move;
      // complex positions can think for thousands of tokens, so keep generous
      // headroom (billing is usage-based, the cap only prevents truncation)
      maxTokens: 8192,
    }).then((result) => {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[opponent] attempt=${attempt} finish=${result.finishReason} ${seconds}s | tokens in=${result.usage.promptTokens} out=${result.usage.completionTokens} | raw="${result.text.trim().slice(0, 20)}"${
          result.text.trim() === "" ? " (EMPTY RESPONSE)" : ""
        }`
      );
      return result;
    });
  };

  // the model occasionally returns empty content (all budget spent thinking);
  // retry once before falling back to the client's random move
  let results = await requestMove(1);
  if (!results.text.trim()) {
    results = await requestMove(2);
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
