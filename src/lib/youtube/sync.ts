import { prisma } from "@/lib/prisma";
import { listUploads, getVideosBatch } from "@/lib/youtube/client";
import { startTranscriptBatch, pollBatchJob } from "@/lib/supadata/client";
import type { ChannelModel as Channel } from "@/generated/prisma/models/Channel";

export async function syncChannel(channel: Channel): Promise<void> {
  const newIds = await collectNewVideoIds(channel);

  await prisma.channel.update({
    where: { id: channel.id },
    data: { lastCheckedAt: new Date() },
  });

  if (newIds.length === 0) return;

  await saveNewVideos(channel.id, newIds);
  await saveTranscripts(newIds);
}

async function collectNewVideoIds(channel: Channel): Promise<string[]> {
  const collected: string[] = [];
  let pageToken: string | undefined;

  while (true) {
    const page = await listUploads(channel.uploadsPlaylistId, { pageToken });
    if (page.videoIds.length === 0) break;

    const existing = await prisma.video.findMany({
      where: { supadataVideoId: { in: page.videoIds } },
      select: { supadataVideoId: true },
    });
    const knownIds = new Set(existing.map((v) => v.supadataVideoId));

    let hitKnown = false;
    for (const id of page.videoIds) {
      if (knownIds.has(id)) {
        hitKnown = true;
        break;
      }
      collected.push(id);
    }

    // newest-first: once we hit a known ID, all subsequent pages are older = already known
    if (hitKnown || !page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return collected;
}

async function saveNewVideos(channelId: string, videoIds: string[]): Promise<void> {
  const metas = await getVideosBatch(videoIds);

  await prisma.video.createMany({
    data: metas.map((v) => ({
      supadataVideoId: v.id,
      channelId,
      title: v.title,
      description: v.description,
      thumbnailUrl: v.thumbnailUrl,
      url: `https://youtube.com/watch?v=${v.id}`,
      durationSeconds: v.durationSeconds,
      publishedAt: v.publishedAt,
    })),
    skipDuplicates: true,
  });
}

async function saveTranscripts(videoIds: string[]): Promise<void> {
  const jobId = await startTranscriptBatch(videoIds);
  const results = await pollBatchJob(jobId);

  if (results.length === 0) return;

  const videos = await prisma.video.findMany({
    where: { supadataVideoId: { in: results.map((r) => r.videoId) } },
    select: { id: true, supadataVideoId: true },
  });
  const videoMap = new Map(videos.map((v) => [v.supadataVideoId, v.id]));

  await prisma.transcript.createMany({
    data: results.flatMap((r) => {
      const id = videoMap.get(r.videoId);
      if (!id) return [];
      return [{ videoId: id, content: r.content, language: r.language }];
    }),
    skipDuplicates: true,
  });
}
