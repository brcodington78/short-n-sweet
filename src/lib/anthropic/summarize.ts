import Anthropic from "@anthropic-ai/sdk";

export const APPROVED_MODELS = {
  free: ["claude-haiku-4-5-20251001"],
  premium: ["claude-haiku-4-5-20251001", "claude-sonnet-5"],
};

export const PROMPT_PRESETS: Record<string, string> = {
  general:
    "You are summarizing a YouTube video for an email newsletter. Write a concise summary (350 words or less) that covers the key points and takeaways. Do not include phrases like \"In this video\" or \"The speaker\". Write in plain prose, no bullet points.",

  stock_picks:
    "You are summarizing a YouTube video for an investing newsletter. List every stock ticker or company mentioned and the brief bull case made for each. Include any specific price targets, time horizons, or catalysts cited. Do not add your own opinions — only what the video actually argues.",

  bull_bear:
    "You are summarizing a YouTube video for an investing newsletter. Identify the central investment thesis. Describe the bull case presented, then any risks or counterarguments acknowledged. Close with the video's overall conclusion. Plain prose, 4-6 sentences.",

  fact_check:
    "You are summarizing a YouTube video for an investing newsletter. Summarize the main claims made in 350 words or less. Then flag any statements that appear speculative, lack cited evidence, or make predictions with specific timeframes — note each one briefly. Be neutral and factual in tone.",
};

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

function client(apiKey?: string) {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey: key });
}

export interface SummaryResult {
  content: string;
  model: string;
  promptVersion: string;
}

export async function summarizeTranscript(
  title: string,
  transcript: string,
  opts: { model?: string; prompt?: string; promptVersion?: string } = {}
): Promise<SummaryResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const systemPrompt = opts.prompt ?? PROMPT_PRESETS.general;
  const promptVersion = opts.promptVersion ?? "preset:general";

  const message = await client().messages.create({
    model,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `${systemPrompt}

Video title: ${title}

<transcript>
${transcript}
</transcript>`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");

  return {
    content: block.text,
    model: message.model,
    promptVersion,
  };
}
