"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Trash2, MessageSquare } from "lucide-react";
import { ProjectSummary } from "@/actions/projects";
import { DeleteProjectModal } from "./DeleteProjectModal";

interface ProjectCardProps {
  projects: ProjectSummary[];
  canDelete?: boolean;
}

export function ProjectCard({ projects, canDelete = true }: ProjectCardProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const title = project.title ?? "Untitled project";
        const updated = new Date(project.updatedAt);
        const timeAgo = Number.isNaN(updated.getTime())
          ? "Unknown date"
          : formatDistanceToNow(updated, { addSuffix: true });
        const msgCount = Math.floor(project.messageCount / 2);

        return (
          <article
            key={project.id}
            className="group relative flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50"
          >
            <div className="mb-2 flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
                <Link
                  href={`/workspace?id=${project.id}`}
                  className="line-clamp-2 break-words rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {title}
                </Link>
              </h2>
              {canDelete && (
                <DeleteProjectModal project={project}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </DeleteProjectModal>
              )}
            </div>

            {project.firstPrompt && (
              <p className="mb-3 line-clamp-2 break-words text-sm leading-relaxed text-muted-foreground">
                {project.firstPrompt}
              </p>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3.5" aria-hidden="true" />
                {msgCount} message{msgCount !== 1 ? "s" : ""}
              </span>
              <span>{timeAgo}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
