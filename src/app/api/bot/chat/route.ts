import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { ANALYZER_PROMPT } from "../../../../lib/prompts";
import { API_CONFIG, COACH_MODEL } from "../../../../lib/config";

// hard wall-clock cap for a single coach analysis; on timeout the player
// gets the partial answer plus a visible warning appended to the bubble
const ANALYSIS_TIMEOUT_MS = 120_000;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const openai = createOpenAI(API_CONFIG);
  const startedAt = Date.now();

  const result = streamText({
    // no structuredOutputs: DeepSeek only supports json_object response
    // format, not OpenAI's json_schema
    model: openai.chat(COACH_MODEL, {
      reasoningEffort: "low",
    }),
    system: ANALYZER_PROMPT,
    messages: [messages.at(-1)],
    maxTokens: 65536,
    abortSignal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    onError: ({ error }) => {
      console.error(`[coach] stream error after ${((Date.now() - startedAt) / 1000).toFixed(1)}s:`, error);
    },
    onFinish: ({ text, usage, finishReason }) => {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[coach] finish=${finishReason} ${seconds}s | tokens in=${usage.promptTokens} out=${usage.completionTokens} | chars=${text.length}${
          finishReason === "length" ? " (TRUNCATED)" : text.length === 0 ? " (EMPTY RESPONSE)" : ""
        }`
      );
    },
  });

  // plain-text protocol (useChat streamProtocol: "text"): pipe the analysis
  // through and append a visible warning when it was cut short by the token
  // cap or the timeout, so the player knows the answer may be incomplete
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const safeEnqueue = (text: string) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      try {
        for await (const delta of result.textStream) {
          safeEnqueue(delta);
        }
      } catch (error) {
        console.error("[coach] stream interrupted:", error);

        // the player pressed Stop (client abort) - close without extra noise
        if (req.signal.aborted) {
          closed = true;
          controller.close();
          return;
        }

        safeEnqueue("\n\n---\n\n⚠️ **分析超时或被中断**，以上内容可能不完整。点击 Talk 可重试。");
        closed = true;
        controller.close();
        return;
      }

      const finishReason = await result.finishReason;

      if (finishReason === "length") {
        safeEnqueue("\n\n---\n\n⚠️ **分析因达到长度上限被截断**，以上内容可能不完整。点击 Talk 可重试。");
      }

      closed = true;
      controller.close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
