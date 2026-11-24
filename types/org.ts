// ─── Organization Types ───────────────────────────────────────────────────────

import type { OrganizationRole } from "@/lib/generated/prisma/client";

export type { OrganizationRole };

export interface OrgContext {
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
}

export interface ActiveOrgResult {
  userId: string;
  clerkId: string;
  organization: {
    id: string;
    name: string;
  };
  membership: {
    id: string;
    role: OrganizationRole;
  };
  role: OrganizationRole;
}
