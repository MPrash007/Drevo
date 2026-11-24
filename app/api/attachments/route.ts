import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/prisma";
import { ATTACHMENT_BUCKET, ATTACHMENT_ID, ATTACHMENT_ORG, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, matchesImageType } from "@/lib/attachments";

const reply = (message: string, status: number) => Response.json({ message }, { status });

async function hasAccess(orgId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return false;
  return !!await db.organizationMember.findFirst({
    where: { organizationId: orgId, user: { clerkId } },
    select: { id: true },
  });
}

async function privateStorage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { storage } = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await storage.getBucket(ATTACHMENT_BUCKET);
  if (error || data?.public !== false) return null;
  return storage.from(ATTACHMENT_BUCKET);
}

async function readImage(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ATTACHMENT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function POST(request: Request) {
  const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
  if (!ATTACHMENT_ORG.test(orgId)) return reply("Invalid organization.", 400);
  if (!await hasAccess(orgId)) return reply("Organization access required.", 403);
  const type = request.headers.get("content-type") ?? "";
  if (!Object.hasOwn(ATTACHMENT_TYPES, type)) return reply("Use a PNG, JPEG, WebP, or GIF image.", 415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES) return reply("Images must be 4 MB or smaller.", 413);
  const bytes = await readImage(request);
  if (!bytes) return reply("Images must be 4 MB or smaller.", 413);
  if (!matchesImageType(bytes, type)) return reply("The file contents do not match the selected image type.", 415);
  const storage = await privateStorage();
  if (!storage) return reply("Private attachment storage is not configured. Contact the server administrator.", 503);
  const id = `${randomUUID()}.${ATTACHMENT_TYPES[type as keyof typeof ATTACHMENT_TYPES]}`;
  const { error } = await storage.upload(`${orgId}/${id}`, bytes, { contentType: type, upsert: false, cacheControl: "0" });
  if (error) return reply("Could not save the attachment. Try again.", 502);
  return Response.json({ url: `/api/attachments?${new URLSearchParams({ orgId, id })}` }, { status: 201 });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const orgId = params.get("orgId") ?? "";
  const id = params.get("id") ?? "";
  if (!ATTACHMENT_ORG.test(orgId) || !ATTACHMENT_ID.test(id)) return reply("Attachment not found.", 404);
  if (!await hasAccess(orgId)) return reply("Attachment not found.", 404);
  const storage = await privateStorage();
  if (!storage) return reply("Private attachment storage is not configured.", 503);
  const { data, error } = await storage.download(`${orgId}/${id}`);
  if (error || !data) return reply("Attachment not found.", 404);
  const type = Object.entries(ATTACHMENT_TYPES).find(([, extension]) => id.endsWith(`.${extension}`))?.[0];
  return new Response(data, { headers: {
    "Content-Type": type ?? "application/octet-stream",
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  } });
}
