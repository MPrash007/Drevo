import { z } from "zod";
import { aj } from "@/lib/arcjet";
import { db } from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import { canonicalProjectPath, isSafeFilePath } from "@/lib/validation";
import { isRegistryVersion, PACKAGE_NAME } from "@/lib/project-dependency";
import { SelectionSchema } from "@/lib/ai-provider-server";
import { checkProjectSource, ProjectSourceError } from "@/lib/project-source";
import { isPrivateAttachmentPath } from "@/lib/attachments";

const Id = z.string().trim().min(1).max(100);
const Files = z.record(z.string().refine(isSafeFilePath), z.object({ code: z.string().max(1_000_000) })).refine(
  (files) => Object.keys(files).length > 0 && Object.keys(files).length <= 300 &&
    Object.values(files).reduce((sum, f) => sum + f.code.length, 0) <= 8_000_000,
  "Invalid or oversized file set"
);
const Deps = z.record(z.string().regex(PACKAGE_NAME), z.string().min(1).max(100))
  .refine((deps) => Object.keys(deps).length <= 80);
export const FileDataSchema = z.object({ files: Files, dependencies: Deps.default({}), title: z.string().max(120).optional() });
const ImageRef = z.union([z.httpUrl().max(2000), z.string().max(250).refine(isPrivateAttachmentPath)]);
const MessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(40000), imageUrl: ImageRef.optional() });
const Messages = z.array(MessageSchema).min(1).max(1000);
export const ImproveRequestSchema = z.object({
  workspaceId: Id.nullable(), orgId: Id, revision: z.number().int().min(0), userRequest: z.string().trim().min(1).max(40000),
  imageUrl: ImageRef.optional(), messages: Messages.optional(),
  selection: SelectionSchema,
});

export function validateApp(fileData: unknown) {
  const parsed = FileDataSchema.safeParse(fileData);
  if (!parsed.success) {
    throw new ProjectSourceError("The model did not produce a valid project file set.");
  }
  checkProjectSource(parsed.data);
  const files = Object.fromEntries(Object.entries(parsed.data.files).map(([path, contents]) => [canonicalProjectPath(path), contents]));
  if (!files["/App.js"]?.code.trim()) throw new ProjectSourceError("The project is missing /App.js.");
  for (const [name, spec] of Object.entries(parsed.data.dependencies)) {
    if (!isRegistryVersion(spec)) throw new ProjectSourceError(`${name} must use an npm registry version, range, or dist-tag.`);
  }
  return { ...parsed.data, files };
}

export const AI_TIMEOUT_RESPONSE = {
  code: "AI_TIMEOUT",
  message: "The AI request reached its time limit. Reload to check the saved project before retrying with a smaller request.",
};

export async function readAiBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > 10_000_000) throw new Error("Request is too large");
  const text = await request.text();
  if (Buffer.byteLength(text) > 10_000_000) throw new Error("Request is too large");
  return JSON.parse(text);
}

export async function protectAi(request: Request, body: unknown, clerkId: string, prompt: string) {
  const decision = await aj.protect(new Request(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(body) }), {
    requested: 1, userId: clerkId, detectPromptInjectionMessage: prompt,
  });
  if (!decision.isDenied()) return null;
  const injection = /prompt.injection/i.test(String(decision.reason?.type ?? ""));
  return Response.json({ message: injection ? "Try describing the app change you want instead." : "Too many requests. Please slow down.", code: injection ? "REFUSED" : "RATE_LIMITED" }, { status: 429 });
}

export async function acquireAiLease(userId: string, workspaceId?: string | null) {
  const keys = [`user:${userId}`, ...(workspaceId ? [`workspace:${workspaceId}`] : [])];
  const token = randomUUID();
  await db.$transaction(async (tx) => {
    for (const key of keys) {
      const claimed = await tx.$queryRaw<{ key: string }[]>`
        INSERT INTO "AiRunLease" ("key", "token", "expiresAt")
        VALUES (${key}, ${token}, CURRENT_TIMESTAMP + INTERVAL '6 minutes')
        ON CONFLICT ("key") DO UPDATE SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt"
        WHERE "AiRunLease"."expiresAt" <= CURRENT_TIMESTAMP RETURNING "key"
      `;
      if (!claimed.length) throw Object.assign(new Error("An AI request is already running. Wait for it to finish."), { status: 409 });
    }
  });
  return async () => {
    try { await db.aiRunLease.deleteMany({ where: { key: { in: keys }, token } }); }
    catch (error) { console.error("[ai] lease release failed:", error); }
  };
}
