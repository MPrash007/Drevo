import { clerkClient } from "@clerk/nextjs/server";

/**
 * Clerk owns identity and membership; Prisma mirrors membership and owns app data.
 *
 * Role mapping (Clerk default roles only — no custom roles):
 *   outbound  OWNER | ADMIN -> "org:admin",  MEMBER -> "org:member"
 *   inbound   "org:admin" -> ADMIN (new memberships only),
 *             "org:member" -> MEMBER (new memberships only).
 * Inbound sync preserves OWNER only when the current Clerk role is org:admin.
 * Clerk role changes/removals otherwise remain authoritative.
 */

export type ClerkOrgRole = "org:admin" | "org:member";

export function toClerkRole(role: "OWNER" | "ADMIN" | "MEMBER"): ClerkOrgRole {
  return role === "MEMBER" ? "org:member" : "org:admin";
}

export function toPrismaRole(role: string): "ADMIN" | "MEMBER" {
  return role === "org:admin" ? "ADMIN" : "MEMBER";
}

export async function getClerk() {
  return clerkClient();
}
