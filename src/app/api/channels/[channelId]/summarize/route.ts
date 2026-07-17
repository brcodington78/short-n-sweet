import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { summarizeTranscript, PROMPT_PRESETS } from "@/lib/anthropic/summarize";
import { ensureUser } from "@/lib/user";

export const maxDuration = 300;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await params;
  await ensureUser(userId);

  const summaries = await prisma.summary.findMany({
    where: { video: { channelId }, userId },
    orderBy: { generatedAt: "desc" },
    select: {
      content: true,
      model: true,
      promptVersion: true,
      generatedAt: true,
      video: { select: { title: true, publishedAt: true } },
    },
  });

  return NextResponse.json({ summaries });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await params;
  await ensureUser(userId);

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 5;

  // Load user tier and their subscription settings for this channel
  const [user, sub] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { isPremium: true } }),
    prisma.subscription.findUnique({
      where: { userId_channelId: { userId, channelId } },
      select: { preferredModel: true, promptPreset: true, customPrompt: true },
    }),
  ]);

  // Resolve effective model and prompt
  const model = sub?.preferredModel ?? "claude-haiku-4-5-20251001";
  const preset = sub?.promptPreset ?? "general";
  const useCustom = user?.isPremium && sub?.customPrompt;
  const prompt = useCustom ? sub!.customPrompt! : PROMPT_PRESETS[preset];
  const promptVersion = useCustom ? "custom:v1" : `preset:${preset}`;

  // Find videos with a transcript but no summary for this user yet
  const videos = await prisma.video.findMany({
    where: {
      channelId,
      transcript: { isNot: null },
      summaries: { none: { userId } },
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      transcript: { select: { content: true } },
    },
  });

  const results: { videoId: string; title: string; ok: boolean; error?: string }[] = [];

  for (const video of videos) {
    if (!video.transcript) continue;
    try {
      const summary = await summarizeTranscript(video.title, video.transcript.content, {
        model,
        prompt,
        promptVersion,
      });
      await prisma.summary.create({
        data: {
          videoId: video.id,
          userId,
          content: summary.content,
          model: summary.model,
          promptVersion: summary.promptVersion,
        },
      });
      results.push({ videoId: video.id, title: video.title, ok: true });
    } catch (err) {
      results.push({
        videoId: video.id,
        title: video.title,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summaryCount = await prisma.summary.count({
    where: { video: { channelId }, userId },
  });

  return NextResponse.json({ results, summaryCount });
}
