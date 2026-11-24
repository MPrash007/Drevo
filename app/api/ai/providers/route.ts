import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { acquireAiLease } from "@/lib/ai-request";
import { checkModel, ProviderInputSchema, providerError, publicProvider, sealProvider, SelectionSchema } from "@/lib/ai-provider-server";
import type { AiSettings } from "@/lib/ai-providers";

const Base = z.object({ orgId: z.string().cuid(), workspaceId: z.string().cuid().optional() });
const Change = Base.and(z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), scope: z.enum(["personal", "organization"]), config: ProviderInputSchema }),
  z.object({ action: z.literal("disconnect"), scope: z.enum(["personal", "organization"]) }),
  z.object({ action: z.literal("policy"), allowPersonal: z.boolean() }),
  z.object({ action: z.literal("select"), selection: SelectionSchema }),
]));

async function context(requestedOrgId?: string, workspaceId?: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true, aiProviderConfig: true, activeOrganizationId: true } });
  if (!user) return null;
  const orgId = requestedOrgId ?? user.activeOrganizationId;
  if (!orgId) return null;
  const membership = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    select: { role: true, organization: { select: { allowPersonalAiProviders: true, aiProviderConfig: true } } },
  });
  if (!membership) return null;
  if (workspaceId && !await db.workspace.findFirst({ where: { id: workspaceId, organizationId: orgId }, select: { id: true } })) return null;
  return { orgId, user, ...membership };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = Base.partial({ orgId: true }).safeParse({ orgId: params.get("orgId") ?? undefined, workspaceId: params.get("workspaceId") ?? undefined });
  if (!input.success) return Response.json({ message: "Invalid organization or workspace." }, { status: 400 });
  const { orgId, workspaceId } = input.data;
  try {
    const ctx = await context(orgId, workspaceId);
    if (!ctx) return Response.json({ message: "Organization access required. Sign in or switch to an organization you belong to." }, { status: 403 });
    const stored = workspaceId && await db.workspaceAiSelection.findUnique({ where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } } });
    const selection = SelectionSchema.safeParse(stored);
    return Response.json({
      orgId: ctx.orgId,
      personal: publicProvider(ctx.user.aiProviderConfig),
      organization: publicProvider(ctx.organization.aiProviderConfig),
      allowPersonal: ctx.organization.allowPersonalAiProviders,
      role: ctx.role,
      selection: selection.success ? selection.data : null,
    } satisfies AiSettings, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") {
      return Response.json({ message: "The AI provider database migration is missing. Ask the server administrator to apply it, then retry." }, { status: 503 });
    }
    console.error("[ai/providers] Could not load connections", code ?? "unknown error");
    return Response.json({ message: "Could not load AI connections. Try again or contact the server administrator." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ message: "Expected a JSON request." }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return Response.json({ message: "Invalid provider settings." }, { status: 400 });
  const text = await request.text();
  if (text.length > 4096) return Response.json({ message: "Invalid provider settings." }, { status: 400 });
  const input = Change.safeParse(await Promise.resolve().then(() => JSON.parse(text)).catch(() => null));
  if (!input.success) return Response.json({ message: "Invalid provider settings." }, { status: 400 });
  const change = input.data;
  if (change.action === "select" && !change.workspaceId) return Response.json({ message: "A project is required." }, { status: 400 });
  const ctx = await context(change.orgId, change.workspaceId);
  const canChange = (role: string | undefined) => change.action === "policy"
    ? role === "OWNER"
    : !!role && (change.action === "select" || change.scope === "personal" || role !== "MEMBER");
  if (!ctx || !canChange(ctx.role)) return Response.json({ message: "You cannot change these settings." }, { status: 403 });

  let encrypted: ReturnType<typeof sealProvider> | undefined;
  if (change.action === "connect") {
    const owner = change.scope === "personal" ? `user:${ctx.user.id}` : `org:${change.orgId}`;
    try { encrypted = sealProvider(change.config, owner); }
    catch { return Response.json({ message: "AI provider encryption is not configured on this server." }, { status: 503 }); }
    let release: () => Promise<void>;
    try { release = await acquireAiLease(ctx.user.id); }
    catch { return Response.json({ message: "An AI request is already running. Try again when it finishes." }, { status: 409 }); }
    try { await checkModel(encrypted, owner, AbortSignal.any([request.signal, AbortSignal.timeout(15000)])); }
    catch (error) { return Response.json({ message: providerError(error) }, { status: 422 }); }
    finally { await release(); }
  }
  const saved = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${change.orgId} FOR UPDATE`;
    const member = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: change.orgId, userId: ctx.user.id } },
      select: { role: true },
    });
    if (!canChange(member?.role)) return false;
    if (change.action === "select") {
      const workspaceId = change.workspaceId!;
      const workspace = await tx.workspace.findFirst({ where: { id: workspaceId, organizationId: change.orgId }, select: { id: true } });
      if (!workspace) return false;
      const { selection } = change;
      const org = await tx.organization.findUniqueOrThrow({ where: { id: change.orgId }, select: { allowPersonalAiProviders: true, aiProviderConfig: true } });
      const config = selection.scope === "organization" ? org.aiProviderConfig
        : org.allowPersonalAiProviders
          ? (await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { aiProviderConfig: true } })).aiProviderConfig
          : null;
      const current = publicProvider(config);
      if (current?.provider !== selection.provider || current.model !== selection.model) return false;
      await tx.workspaceAiSelection.upsert({
        where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
        create: { workspaceId, userId: ctx.user.id, ...selection },
        update: selection,
      });
      return true;
    }
    if (change.action === "policy") {
      await tx.organization.update({ where: { id: change.orgId }, data: { allowPersonalAiProviders: change.allowPersonal } });
    } else {
      // Clearing the payload removes the previous encrypted key.
      const aiProviderConfig = encrypted ?? {};
      if (change.scope === "personal") await tx.user.update({ where: { id: ctx.user.id }, data: { aiProviderConfig } });
      else await tx.organization.update({ where: { id: change.orgId }, data: { aiProviderConfig } });
    }
    return true;
  });
  return saved ? Response.json({ ok: true })
    : Response.json({ message: "The connection or organization access changed. Reload and try again." }, { status: 409 });
}
