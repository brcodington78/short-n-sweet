import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { APPROVED_MODELS, PROMPT_PRESETS } from "@/lib/anthropic/summarize";
import { ensureUser } from "@/lib/user";

type Params = { params: Promise<{ channelId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await params;
  await ensureUser(userId);

  const [sub, user] = await Promise.all([
    prisma.subscription.findUnique({
      where: { userId_channelId: { userId, channelId } },
      select: { preferredModel: true, promptPreset: true, customPrompt: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { isPremium: true } }),
  ]);

  if (!sub) return NextResponse.json({ error: "Not subscribed to this channel" }, { status: 404 });

  return NextResponse.json({
    preferredModel: sub.preferredModel ?? "claude-haiku-4-5-20251001",
    promptPreset: sub.promptPreset ?? "general",
    hasCustomPrompt: sub.customPrompt !== null,
    isPremium: user?.isPremium ?? false,
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await params;
  await ensureUser(userId);
  const body = await req.json() as {
    preferredModel?: string;
    promptPreset?: string;
    customPrompt?: string | null;
  };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPremium: true },
  });

  // Validate model
  if (body.preferredModel !== undefined) {
    const allowed = user?.isPremium ? APPROVED_MODELS.premium : APPROVED_MODELS.free;
    if (!allowed.includes(body.preferredModel)) {
      return NextResponse.json(
        { error: `Model not available on your plan. Allowed: ${allowed.join(", ")}` },
        { status: user?.isPremium ? 400 : 403 }
      );
    }
  }

  // Validate preset
  if (body.promptPreset !== undefined && !(body.promptPreset in PROMPT_PRESETS)) {
    return NextResponse.json(
      { error: `Unknown preset. Valid: ${Object.keys(PROMPT_PRESETS).join(", ")}` },
      { status: 400 }
    );
  }

  // Validate custom prompt
  if (body.customPrompt !== undefined && body.customPrompt !== null) {
    if (!user?.isPremium) {
      return NextResponse.json({ error: "Custom prompts require a premium plan" }, { status: 403 });
    }
    if (body.customPrompt.length > 2000) {
      return NextResponse.json({ error: "Custom prompt must be 2000 characters or fewer" }, { status: 400 });
    }
  }

  const sub = await prisma.subscription.update({
    where: { userId_channelId: { userId, channelId } },
    data: {
      ...(body.preferredModel !== undefined && { preferredModel: body.preferredModel }),
      ...(body.promptPreset !== undefined && { promptPreset: body.promptPreset }),
      ...(body.customPrompt !== undefined && { customPrompt: body.customPrompt }),
    },
    select: { preferredModel: true, promptPreset: true, customPrompt: true },
  });

  return NextResponse.json({
    preferredModel: sub.preferredModel ?? "claude-haiku-4-5-20251001",
    promptPreset: sub.promptPreset ?? "general",
    hasCustomPrompt: sub.customPrompt !== null,
  });
}
