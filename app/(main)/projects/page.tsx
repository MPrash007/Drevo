import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Zap } from "lucide-react";
import { ProjectCard } from "@/components/ProjectCard";
import Link from "next/link";
import { getUserProjects } from "@/actions/projects";
import { getActiveOrganization } from "@/lib/org";

function EmptyState({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-2 py-16 text-center sm:py-24">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-muted">
        <Zap className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="mb-1 text-base font-medium text-foreground">No projects yet</p>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">
        {canCreate
          ? "Head to the homepage and describe what you want to build."
          : "An admin in your organization can create the first project."}
      </p>
      {canCreate && (
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Zap className="size-3.5 fill-current" aria-hidden="true" />
          Start building
        </Link>
      )}
    </div>
  );
}

export default async function ProjectsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const active = await getActiveOrganization();
  const projects = await getUserProjects();
  const canCreate = active.role === "OWNER" || active.role === "ADMIN";

  return (
    <div className="min-h-screen bg-background px-4 pt-24 pb-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-serif text-4xl font-medium tracking-tight text-violet-800 sm:text-5xl dark:text-violet-300">
              Projects
            </h1>
            <p className="mt-3 max-w-prose text-sm break-words text-muted-foreground">
              {active.organization.name} · {projects.length} project
              {projects.length !== 1 ? "s" : ""} · shared workspace
            </p>
          </div>
          {canCreate && (
            <Link
              href="/"
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80 sm:w-auto"
            >
              <Zap className="size-3.5 fill-current" aria-hidden="true" />
              New project
            </Link>
          )}
        </div>

        {projects.length === 0 ? (
          <EmptyState canCreate={canCreate} />
        ) : (
          <ProjectCard projects={projects} canDelete={canCreate} />
        )}
      </div>
    </div>
  );
}
