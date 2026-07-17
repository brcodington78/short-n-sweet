const BASE = "https://api.supadata.ai/v1";

function apiKey() {
  const k = process.env.SUPA_DATA_KEY;
  if (!k) throw new Error("SUPA_DATA_KEY is not set");
  return k;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supadata POST ${path} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-api-key": apiKey() },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supadata GET ${path} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface TranscriptResult {
  videoId: string;
  content: string;
  language: string | null;
}

type BatchStatus = "queued" | "active" | "completed" | "failed";

interface BatchJobResponse {
  jobId: string;
}

interface BatchJobStatus {
  status: BatchStatus;
  results?: Array<{
    videoId: string;
    transcript?: { content: unknown; lang?: string };
    error?: string;
  }>;
}

export async function getTranscript(
  videoId: string
): Promise<TranscriptResult | null> {
  const res = await fetch(
    `${BASE}/youtube/transcript?videoId=${encodeURIComponent(videoId)}&text=true`,
    { headers: { "x-api-key": apiKey() } }
  );

  if (res.status === 404) return null; // no transcript available for this video
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supadata GET /youtube/transcript ${res.status}: ${text}`);
  }

  const data = await res.json() as { content: string; lang?: string };
  return {
    videoId,
    content: typeof data.content === "string"
      ? data.content
      : (data.content as Array<{ text: string }>).map((s) => s.text).join(" "),
    language: data.lang ?? null,
  };
}

export async function startTranscriptBatch(
  videoIds: string[]
): Promise<string> {
  const { jobId } = await post<BatchJobResponse>(
    "/youtube/transcript/batch",
    { videoIds }
  );
  return jobId;
}

export async function pollBatchJob(
  jobId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<TranscriptResult[]> {
  const timeout = opts.timeoutMs ?? 5 * 60 * 1000; // 5 min default
  const interval = opts.intervalMs ?? 5000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const job = await get<BatchJobStatus>(`/youtube/batch/${jobId}`);

    if (job.status === "completed") {
      return (job.results ?? []).flatMap((r) => {
        if (!r.transcript) return [];
        const raw = r.transcript.content;
        const content =
          typeof raw === "string"
            ? raw
            : (raw as Array<{ text: string }>).map((s) => s.text).join(" ");
        return [{ videoId: r.videoId, content, language: r.transcript.lang ?? null }];
      });
    }

    if (job.status === "failed") {
      throw new Error(`Supadata batch job ${jobId} failed`);
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`Supadata batch job ${jobId} timed out after ${timeout}ms`);
}
