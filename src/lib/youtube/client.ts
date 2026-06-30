const BASE = "https://www.googleapis.com/youtube/v3";

function key() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error("YOUTUBE_API_KEY is not set");
  return k;
}

async function yt<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("key", key());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube API ${path} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface YoutubeChannelInfo {
  channelId: string;
  uploadsPlaylistId: string;
  name: string;
  handle: string | null;
  description: string;
  thumbnailUrl: string | null;
}

export async function getChannel(channelId: string): Promise<YoutubeChannelInfo> {
  const data = await yt<{
    items?: {
      id: string;
      snippet: {
        title: string;
        customUrl?: string;
        description: string;
        thumbnails?: { default?: { url: string } };
      };
      contentDetails: { relatedPlaylists: { uploads: string } };
    }[];
  }>("/channels", {
    part: "snippet,contentDetails",
    id: channelId,
  });

  const item = data.items?.[0];
  if (!item) throw new Error(`Channel not found: ${channelId}`);

  return {
    channelId: item.id,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    name: item.snippet.title,
    handle: item.snippet.customUrl ?? null,
    description: item.snippet.description,
    thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
  };
}

export interface UploadPage {
  videoIds: string[];
  nextPageToken: string | null;
}

export async function listUploads(
  playlistId: string,
  opts: { pageToken?: string } = {}
): Promise<UploadPage> {
  const params: Record<string, string> = {
    part: "contentDetails",
    playlistId,
    maxResults: "50",
  };
  if (opts.pageToken) params.pageToken = opts.pageToken;

  const data = await yt<{
    nextPageToken?: string;
    items?: { contentDetails: { videoId: string } }[];
  }>("/playlistItems", params);

  return {
    videoIds: (data.items ?? []).map((i) => i.contentDetails.videoId),
    nextPageToken: data.nextPageToken ?? null,
  };
}

export interface YoutubeVideoMeta {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
}

function parseDuration(iso: string): number | null {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] ?? "0") * 3600) +
    (parseInt(m[2] ?? "0") * 60) +
    parseInt(m[3] ?? "0");
}

export async function getVideosBatch(videoIds: string[]): Promise<YoutubeVideoMeta[]> {
  const results: YoutubeVideoMeta[] = [];

  // YouTube videos.list accepts up to 50 IDs per call
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const data = await yt<{
      items?: {
        id: string;
        snippet: {
          title: string;
          description: string;
          publishedAt?: string;
          thumbnails?: { default?: { url: string } };
        };
        contentDetails: { duration: string };
      }[];
    }>("/videos", {
      part: "snippet,contentDetails",
      id: chunk.join(","),
    });

    for (const item of data.items ?? []) {
      results.push({
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
        durationSeconds: parseDuration(item.contentDetails.duration),
        publishedAt: item.snippet.publishedAt
          ? new Date(item.snippet.publishedAt)
          : null,
      });
    }
  }

  return results;
}
