ALTER TABLE "User" ADD COLUMN "aiProviderConfig" JSONB;
ALTER TABLE "Organization"
  ADD COLUMN "aiProviderConfig" JSONB,
  ADD COLUMN "allowPersonalAiProviders" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "WorkspaceAiSelection" (
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "scope" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  PRIMARY KEY ("workspaceId", "userId")
);
CREATE INDEX "WorkspaceAiSelection_userId_idx" ON "WorkspaceAiSelection"("userId");
