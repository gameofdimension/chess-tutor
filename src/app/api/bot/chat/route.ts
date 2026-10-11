import { streamText } from "ai";
import type { CoreMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { ANALYZER_PROMPT } from "../../../../lib/prompts";
import { API_CONFIG, COACH_MODEL } from "../../../../lib/config";

// hard wall-clock cap for a single coach analysis attempt; on timeout the
// player gets the partial answer plus a visible warning in the bubble
const ANALYSIS_TIMEOUT_MS = 120_000;

// DeepSeek occasionally spends its whole output budget on the thinking
// phase and returns zero visible content (finish=stop, empty text) -
// retry once before surfacing an error to the player
const MAX_ATTEMPTS = 2;

export async function POST(req: Request) {
  const { messages } = await req.json();

  // free-form multi-turn chat: the client sends the whole conversation;
  // keep only user/assistant turns (drop system notices injected into
  // the panel) so the coach can answer follow-up questions with context
  const history: CoreMessage[] = (messages as CoreMessage[]).filter(
    (message) => message.role === "user" || message.role === "assistant"
  );

  const openai = createOpenAI(API_CONFIG);
  const startedAt = Date.now();

  const requestAnalysis = (attempt: number) =>
    streamText({
      // no structuredOutputs: DeepSeek only supports json_object response
      // format, not OpenAI's json_schema
      model: openai.chat(COACH_MODEL, {
        reasoningEffort: "low",
      }),
      system: ANALYZER_PROMPT,
      // full conversation history so follow-ups have context
      messages: history,
      maxTokens: 65536,
      abortSignal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
      onError: ({ error }) => {
        console.error(`[coach] attempt=${attempt} stream error:`, error);
      },
      onFinish: ({ text, usage, finishReason }) => {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(
          `[coach] attempt=${attempt} finish=${finishReason} ${seconds}s | tokens in=${usage.promptTokens} out=${usage.completionTokens} | chars=${text.length}${
            finishReason === "length" ? " (TRUNCATED)" : text.length === 0 ? " (EMPTY RESPONSE)" : ""
          }`
        );
      },
    });

  // plain-text protocol (useChat streamProtocol: "text"): pipe the analysis
  // through, retry once when the model returns no visible content, and
  // append a visible warning when it was cut short by the token cap or the
  // timeout, so the player knows the answer may be incomplete
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
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const result = requestAnalysis(attempt);
          let emitted = 0;

          for await (const delta of result.textStream) {
            emitted += delta.length;
            safeEnqueue(delta);
          }

          if (emitted > 0) {
            const finishReason = await result.finishReason;

            if (finishReason === "length") {
              safeEnqueue("\n\n---\n\n⚠️ **分析因达到长度上限被截断**，以上内容可能不完整。重新提问即可重试。");
            }

            break;
          }

          // nothing visible was produced
          if (attempt < MAX_ATTEMPTS) {
            console.log(`[coach] attempt=${attempt} produced no content - retrying`);
          } else {
            safeEnqueue("\n\n---\n\n⚠️ **教练没有返回内容**（模型输出为空）。重新提问即可重试。");
          }
        }
      } catch (error) {
        console.error("[coach] stream interrupted:", error);

        // the client went away (abort/reload) - close without extra noise
        if (req.signal.aborted) {
          closed = true;
          controller.close();
          return;
        }

        safeEnqueue("\n\n---\n\n⚠️ **分析超时或被中断**，以上内容可能不完整。重新提问即可重试。");
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
