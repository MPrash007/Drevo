import { db } from "@/lib/prisma";
import { createWorkspaceVersion, pruneVersionsBestEffort } from "@/lib/versions";
import { validateApp } from "@/lib/ai-request";
import type { FileData, Message } from "@/types/workspace";
import type { AiSelection } from "@/lib/ai-providers";

export async function saveAiWorkspace(args: {
  workspaceId?: string | null; revision?: number; orgId: string; userId: string;
  fileData: FileData; messages: Message[]; title?: string; summary: string; signal: AbortSignal; selection?: AiSelection;
}) {
  const fileData = validateApp(args.fileData);
  args.signal.throwIfAborted();
  const result = await db.$transaction(async (tx) => {
    args.signal.throwIfAborted();
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${args.orgId} FOR UPDATE`;
    const member = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: args.orgId, userId: args.userId } } });
    if (!member || (!args.workspaceId && member.role === "MEMBER")) throw new Error("Organization access changed.");
    let workspace: { id: string; revision: number };
    if (args.workspaceId) {
      const before = await tx.workspace.findUnique({ where: { id: args.workspaceId }, select: { fileData: true, revision: true, organizationId: true } });
      if (!before || before.organizationId !== args.orgId || before.revision !== args.revision) throw new Error("Workspace changed. Reload before retrying.");
      const updated = await tx.workspace.updateMany({
        where: { id: args.workspaceId, organizationId: args.orgId, revision: args.revision },
        data: { fileData: fileData as never, messages: args.messages as never, revision: { increment: 1 } },
      });
      if (!updated.count) throw new Error("Workspace changed. Reload before retrying.");
      if (before.fileData) await createWorkspaceVersion(tx, args.workspaceId, before.fileData, args.summary);
      workspace = { id: args.workspaceId, revision: before.revision + 1 };
    } else {
      workspace = await tx.workspace.create({ data: { organizationId: args.orgId, createdById: args.userId, fileData: fileData as never, messages: args.messages as never, title: args.title }, select: { id: true, revision: true } });
    }
    if (args.selection) await tx.workspaceAiSelection.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: args.userId } },
      create: { workspaceId: workspace.id, userId: args.userId, ...args.selection },
      update: {},
    });
    args.signal.throwIfAborted();
    return { workspaceId: workspace.id, revision: workspace.revision };
  }, { timeout: 15000 });
  // Only cleanup remains outside the commit; it can never report a failed run.
  await pruneVersionsBestEffort(result.workspaceId);
  return result;
}
