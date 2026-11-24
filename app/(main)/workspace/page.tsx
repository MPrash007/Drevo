import { WorkspaceClient } from "@/components/WorkspaceClient";
import { getWorkspaceUser, getWorkspaceById } from "@/actions/workspace";
import { SelectionSchema } from "@/lib/ai-provider-server";

interface WorkspacePageProps {
  searchParams: Promise<{ prompt?: string; id?: string; org?: string; scope?: string; provider?: string; model?: string; start?: string }>;
}

export default async function WorkspacePage({
  searchParams,
}: WorkspacePageProps) {
  const { prompt, id, org, scope, provider, model, start } = await searchParams;

  const user = await getWorkspaceUser(id);

  let workspace = null;
  if (id) {
    workspace = await getWorkspaceById(id);
  }
  const selected = !id && org === user.orgId ? SelectionSchema.safeParse({ scope, provider, model }) : null;

  return (
    <WorkspaceClient
      key={`${user.orgId}:${workspace?.id ?? "new"}:${workspace?.revision ?? 0}`}
      initialPrompt={prompt ?? null}
      initialSelection={selected?.success ? selected.data : undefined}
      launchToken={selected?.success && typeof start === "string" ? start : undefined}
      workspace={workspace}
      orgId={user.orgId}
      userRole={user.role}
      githubConnected={user.githubConnected}
      githubUsername={user.githubUsername}
    />
  );
}
