"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteProject, ProjectSummary } from "@/actions/projects";

interface DeleteProjectModalProps {
  project: ProjectSummary;
  children: React.ReactNode;
}

export function DeleteProjectModal({
  project,
  children,
}: DeleteProjectModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const title = project.title ?? "Untitled project";

  const handleDelete = () => {
    setError("");
    startTransition(async () => {
      try {
        await deleteProject(project.id);
        toast.success("Project deleted.");
        router.refresh();
      } catch {
        const message = "Could not delete this project. Try again.";
        setError(message);
        toast.error(message);
      }
    });
  };

  return (
    <Dialog onOpenChange={(next) => { if (next) setError(""); }}>
      <DialogTrigger
        aria-label={`Delete ${title}`}
        className="relative z-10 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {children}
      </DialogTrigger>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-foreground">
            Delete project?
          </DialogTitle>
          <DialogDescription className="text-sm break-words text-muted-foreground">
            &ldquo;{title}&rdquo; will be permanently deleted. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter className="gap-2">
          <DialogClose
            render={<Button type="button" variant="outline" disabled={isPending} className="min-h-11 w-full sm:min-h-9 sm:w-auto" />}
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
            aria-busy={isPending}
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
          >
            {isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
