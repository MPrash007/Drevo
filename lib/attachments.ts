export const ATTACHMENT_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_BUCKET = "drevo-private-attachments";

export const ATTACHMENT_ID = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}\.(?:png|jpg|webp|gif)$/i;
export const ATTACHMENT_ORG = /^c[a-z\d]{8,99}$/i;

export function isPrivateAttachmentPath(url: string) {
  if (!url.startsWith("/api/attachments?")) return false;
  const params = new URLSearchParams(url.slice("/api/attachments?".length));
  return [...params.keys()].length === 2
    && ATTACHMENT_ORG.test(params.get("orgId") ?? "")
    && ATTACHMENT_ID.test(params.get("id") ?? "");
}

export function matchesImageType(data: Uint8Array, type: string) {
  const prefix = (...bytes: number[]) => bytes.every((value, index) => data[index] === value);
  switch (type) {
    case "image/png": return prefix(137, 80, 78, 71, 13, 10, 26, 10);
    case "image/jpeg": return prefix(255, 216, 255);
    case "image/gif": return prefix(71, 73, 70, 56, 55, 97) || prefix(71, 73, 70, 56, 57, 97);
    case "image/webp": return prefix(82, 73, 70, 70) && [87, 69, 66, 80].every((value, index) => data[index + 8] === value);
    default: return false;
  }
}
