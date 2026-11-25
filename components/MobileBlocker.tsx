"use client";

import { Monitor, Smartphone, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  running?: boolean;
  status?: string;
  error?: string | null;
  onStop?: () => void;
}

export function MobileBlocker({ running = false, status, error, onStop }: Props) {
  return (
    <div className="h-[calc(100dvh-4rem)] overflow-y-auto bg-background">
      <div className="flex min-h-full flex-col items-center justify-center px-6 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-center">
        {!running && (
          <div className="relative mb-8 flex items-center justify-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-border bg-muted/50 shadow-lg shadow-black/10">
              <Monitor className="h-12 w-12 text-violet-400" aria-hidden="true" />
            </div>
            <div className="absolute -right-3 -bottom-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background shadow-md shadow-black/10">
              <Smartphone className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>
        )}

        <h1 className="mb-3 max-w-sm font-serif text-3xl font-semibold tracking-tight text-foreground">
          Desktop Required
        </h1>
        {running ? (
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-4 text-left">
            <p role="status" className="w-full text-sm text-foreground">
              A build is still running.{status ? ` ${status}` : ""}
            </p>
            <Button type="button" variant="outline" className="min-h-11 w-full" onClick={onStop}>
              <Square className="size-3.5" aria-hidden="true" />
              Stop run
            </Button>
          </div>
        ) : (
          <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
            This workspace needs a window at least 768 pixels wide and 500 pixels tall. Widen the window, or open the page on a desktop or laptop.
          </p>
        )}
        {!running && !error && (
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Nothing runs from this screen. A prompt already in this tab stays here until the window is large enough.
          </p>
        )}
        {running && (
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            Widen the window to return to the workspace. Stop leaves the project as it is.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-6 max-w-sm text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
