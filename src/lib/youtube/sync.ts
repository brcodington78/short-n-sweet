import { prisma } from "@/lib/prisma";
import { listUploads, getVideosBatch } from "@/lib/youtube/client";
import { getTranscript } from "@/lib/supadata/client";
import type { ChannelModel as Channel } from "@/generated/prisma/models/Channel";

export async function syncChannel(
  channel: Channel,
  options: { limit?: number } = {}
): Promise<void> {
  const newIds = await collectNewVideoIds(channel, options.limit);

  await prisma.channel.update({
    where: { id: channel.id },
    data: { lastCheckedAt: new Date() },
  });

  if (newIds.length > 0) {
    await saveNewVideos(channel.id, newIds);
  }

  // Fetch transcripts for any videos in this channel that don't have one yet
  // (covers both new videos and ones where transcript fetching previously failed)
  // hasCaptions=true (YouTube API) only flags human captions, not auto-generated ones.
  // Supadata can fetch auto-generated captions at the same 1-credit rate and returns
  // 404 (no charge) when no captions exist at all — so let Supadata be the gate.
  const missing = await prisma.video.findMany({
    where: { channelId: channel.id, transcript: null },
    orderBy: { publishedAt: "desc" },
    take: options.limit,
    select: { id: true, youtubeVideoId: true, hasCaptions: true },
  });

  await saveTranscripts(missing);
}

async function collectNewVideoIds(
  channel: Channel,
  limit?: number
): Promise<string[]> {
  const collected: string[] = [];
  let pageToken: string | undefined;

  while (true) {
    const page = await listUploads(channel.uploadsPlaylistId, { pageToken });
    if (page.videoIds.length === 0) break;

    const existing = await prisma.video.findMany({
      where: { youtubeVideoId: { in: page.videoIds } },
      select: { youtubeVideoId: true },
    });
    const knownIds = new Set(existing.map((v) => v.youtubeVideoId));

    let hitKnown = false;
    for (const id of page.videoIds) {
      if (knownIds.has(id)) {
        hitKnown = true;
        // With a limit we skip known IDs and keep searching for new ones.
        // Without a limit (full sync) we stop here — all older videos are assumed present.
        if (limit) continue;
        else break;
      }
      collected.push(id);
      if (limit && collected.length >= limit) return collected;
    }

    if ((!limit && hitKnown) || !page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return collected;
}

async function saveNewVideos(channelId: string, videoIds: string[]): Promise<void> {
  const metas = await getVideosBatch(videoIds);

  await prisma.video.createMany({
    data: metas.map((v) => ({
      youtubeVideoId: v.id,
      channelId,
      title: v.title,
      description: v.description,
      thumbnailUrl: v.thumbnailUrl,
      url: `https://youtube.com/watch?v=${v.id}`,
      durationSeconds: v.durationSeconds,
      publishedAt: v.publishedAt,
      hasCaptions: v.hasCaptions,
    })),
    skipDuplicates: true,
  });
}

async function saveTranscripts(
  videos: { id: string; youtubeVideoId: string; hasCaptions: boolean }[]
): Promise<void> {
  for (const video of videos) {
    const result = await getTranscript(video.youtubeVideoId);
    if (!result) continue;

    await prisma.transcript.upsert({
      where: { videoId: video.id },
      create: {
        videoId: video.id,
        content: result.content,
        language: result.language,
        source: video.hasCaptions ? "HUMAN" : "AUTO",
      },
      update: {},
    });
  }
}
