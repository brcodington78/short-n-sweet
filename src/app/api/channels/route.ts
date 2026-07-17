import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getChannel } from "@/lib/youtube/client";

export async function GET() {
  const channels = await prisma.channel.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { videos: true } } },
  });

  return NextResponse.json({ channels });
}

export async function POST(req: NextRequest) {
  const { handle } = await req.json();

  if (!handle || typeof handle !== "string") {
    return NextResponse.json(
      { error: "handle is required (e.g. '@TickerSymbolYOU' or a channel ID)" },
      { status: 400 }
    );
  }

  const info = await getChannel(handle);

  const channel = await prisma.channel.upsert({
    where: { youtubeChannelId: info.channelId },
    create: {
      youtubeChannelId: info.channelId,
      uploadsPlaylistId: info.uploadsPlaylistId,
      name: info.name,
      handle: info.handle,
      description: info.description,
      thumbnailUrl: info.thumbnailUrl,
      url: `https://youtube.com/${info.handle ?? info.channelId}`,
    },
    update: {},
  });

  return NextResponse.json({ channel }, { status: 201 });
}
