import { CoreMessage, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { OPPONENT_REASONING_PROMPT } from "../../../../lib/prompts";
import { API_CONFIG, OPPONENT_MODEL } from "../../../../lib/config";

const MAX_ATTEMPTS = 3;

// SAN move core: piece?, disambiguation?, capture?, target, promotion?
// e.g. "Nbd5" -> (N, d5); "exd8=Q" -> (undefined pawn, d8, Q); "e4" -> (e4)
const MOVE_CORE = /^([KQRBN])?(?:[a-h]|[1-8]|[a-h][1-8])?(x?)([a-h][1-8])(?:=?([QRBN]))?$/;

const cleanSan = (san: string) => san.replace(/[+#!?]+/g, "").trim();

/**
 * Reconcile a model-produced move against the actual legal-move list:
 * exact SAN first; otherwise match on (piece, target, promotion) ignoring
 * disambiguation characters the model tends to omit (e.g. it writes "Nxd5"
 * when the legal notation is "Nbd5"). Returns null when the move matches
 * nothing or is ambiguous.
 */
const reconcileMove = (candidate: string, legalMoves: string[]): string | null => {
  const cleaned = cleanSan(candidate);

  if (legalMoves.includes(cleaned)) {
    return cleaned;
  }

  const parsed = cleaned.match(MOVE_CORE);

  if (!parsed) {
    return null;
  }

  const [, piece, , target, promotion] = parsed;

  const matches = legalMoves.filter((legal) => {
    const parsedLegal = cleanSan(legal).match(MOVE_CORE);

    if (!parsedLegal) {
      return false;
    }

    return parsedLegal[1] === piece && parsedLegal[3] === target && parsedLegal[4] === promotion;
  });

  return matches.length === 1 ? matches[0] : null;
};

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

  const legalList: string[] = Array.isArray(legalMoves) ? legalMoves : [];

  // ask the model until it produces a move that reconciles against the
  // legal-move list (handles empty responses AND notation mismatches like
  // a missing disambiguator); the client's random fallback stays as the
  // last resort if every attempt fails
  let move = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await requestMove(attempt);

    let candidate = result.text.trim();

    if (candidate.includes(".")) {
      candidate = candidate.replace(/\./g, "").trim();
    }

    if (candidate.includes(" ")) {
      candidate = candidate.split(" ").at(-1) ?? candidate;
    }

    if (!candidate) {
      continue;
    }

    if (legalList.length === 0) {
      // no list to validate against - trust the model verbatim
      move = candidate;
      break;
    }

    const matched = reconcileMove(candidate, legalList);

    if (matched) {
      console.log(`[opponent] attempt=${attempt} raw="${candidate}" -> legal "${matched}"`);
      move = matched;
      break;
    }

    console.log(`[opponent] attempt=${attempt} raw="${candidate}" matches no legal move - ${attempt < MAX_ATTEMPTS ? "retrying" : "giving up (client falls back to random)"}`);
  }

  return Response.json({ move });
}
