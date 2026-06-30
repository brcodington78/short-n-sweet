import { prisma } from "@/lib/prisma";
import { syncChannel } from "@/lib/youtube/sync";
import { NextRequest, NextResponse } from "next/server";

// Vercel Cron calls this with GET; allow long execution for transcript polling
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channels = await prisma.channel.findMany({
    where: { subscriptions: { some: {} } },
    orderBy: { lastCheckedAt: "asc" },
  });

  const results: { channelId: string; status: string; error?: string }[] = [];

  for (const channel of channels) {
    try {
      await syncChannel(channel);
      results.push({ channelId: channel.id, status: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ channelId: channel.id, status: "error", error: message });
    }
  }

  return NextResponse.json({ synced: results.length, results });
}
