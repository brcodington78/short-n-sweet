import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncChannel } from "@/lib/youtube/sync";

// Transcript polling can take several minutes for large batches
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params;

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
  });

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const limitParam = _req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  await syncChannel(channel, { limit });

  const videoCount = await prisma.video.count({ where: { channelId } });
  const transcriptCount = await prisma.transcript.count({
    where: { video: { channelId } },
  });

  return NextResponse.json({ ok: true, videoCount, transcriptCount });
}
