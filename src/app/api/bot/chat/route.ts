import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { ANALYZER_PROMPT } from "../../../../lib/prompts";
import { API_CONFIG, COACH_MODEL } from "../../../../lib/config";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const openai = createOpenAI(API_CONFIG);

  const result = await streamText({
    // no structuredOutputs: DeepSeek only supports json_object response
    // format, not OpenAI's json_schema
    model: openai.chat(COACH_MODEL),
    system: ANALYZER_PROMPT,
    messages: [messages.at(-1)],
  });

  return result.toDataStreamResponse();
}
