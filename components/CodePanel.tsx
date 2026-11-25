// CodePanel.tsx
/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { useTheme } from "next-themes";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackFileExplorer,
  useSandpack,
  type SandpackPreviewRef,
} from "@codesandbox/sandpack-react";
import {
  Eye,
  Code2,
  Download,
  AlertTriangle,
  Bot,
  Loader2,
  History,
  Maximize2,
  Minimize2,
  Monitor,
  Smartphone,
  Upload,
  X,
  RefreshCw,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { RingLoader } from "react-spinners";
import JSZip from "jszip";
import {
  BASE_DEPENDENCIES,
  buildProjectFiles,
  exportZipName,
} from "@/lib/export-project";
import { GithubPushDialog, type LastPush } from "@/components/GithubPushDialog";
import { pushToGithub } from "@/lib/github-push-client";
import { summarizePreviewError } from "@/lib/preview-error";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { FileData, StatusStep } from "@/types/workspace";
import type { VersionSummary } from "@/types/version";

type ActiveTab = "preview" | "code";
type PreviewDevice = "desktop" | "mobile";
type ProjectFiles = Record<string, { code: string }>;

interface CodePanelProps {
  fileData: FileData | null;
  isGenerating: boolean;
  statusLog: StatusStep[];
  onFixError: (error: string) => Promise<void>;
  appTitle: string | null;
  isImproving: boolean;
  versions: VersionSummary[];
  versionsLoading: boolean;
  onRestoreVersion: (versionId: string) => Promise<void>;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  workspaceId: string | null;
  githubConnected: boolean;
  githubUsername: string | null;
  lastPush: LastPush | null;
  onPushed: (push: LastPush) => void;
  onGithubConnectionChange: (connected: boolean, username: string | null) => void;
}

const SANDPACK_OPTIONS = {
  externalResources: ["https://cdn.tailwindcss.com"],
  recompileMode: "delayed" as const,
  recompileDelay: 500,
  initMode: "immediate" as const,
};

const iconButtonClass =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

function filesSignature(files: ProjectFiles) {
  return Object.keys(files)
    .sort()
    .map((path) => `${path}\0${files[path].code}`)
    .join("\0");
}

function exportFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Cannot export:") || message.startsWith("Unsafe project")) return message;
  return "Could not create the ZIP. Try the download again.";
}

function dependencyKeyFor(dependencies: Record<string, string> | undefined) {
  return Object.entries(dependencies ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => `${name}\0${version}`)
    .join("\n");
}

function dependenciesFromKey(key: string) {
  const extra = Object.fromEntries(
    key
      ? key.split("\n").map((line) => {
          const splitAt = line.indexOf("\0");
          return [line.slice(0, splitAt), line.slice(splitAt + 1)];
        })
      : [],
  );
  return { ...BASE_DEPENDENCIES, ...extra };
}

function SandpackFileSync({
  files,
  previewRef,
}: {
  files: ProjectFiles;
  previewRef: RefObject<SandpackPreviewRef | null>;
}) {
  const { sandpack, listen } = useSandpack();
  const filesRef = useRef(files);
  const sandpackFilesRef = useRef(sandpack.files);
  const environmentRef = useRef(sandpack.environment);
  const signature = useMemo(() => filesSignature(files), [files]);
  // The provider mounts with these files, so the first client compile already
  // has them. Do not schedule a delayed update Sandpack can drop while compiling.
  const iframeSignatureRef = useRef(signature);
  const flushRef = useRef(() => {});

  useEffect(() => {
    filesRef.current = files;
    sandpackFilesRef.current = sandpack.files;
    environmentRef.current = sandpack.environment;
    flushRef.current = () => {
      const desired = filesRef.current;
      if (iframeSignatureRef.current === signature) return;
      const client = previewRef.current?.getClient();
      if (!client || client.status !== "done") return;
      const current = sandpackFilesRef.current;
      const next = { ...current };
      for (const [path, file] of Object.entries(desired)) {
        next[path] = { ...current[path], code: file.code };
      }
      client.updateSandbox({ files: next, template: environmentRef.current });
      iframeSignatureRef.current = signature;
    };
  });

  useEffect(() => {
    if (signature === iframeSignatureRef.current) return;
    const current = sandpack.files;
    const changes = Object.fromEntries(
      Object.entries(files).filter(([path, file]) => current[path]?.code !== file.code),
    );
    if (Object.keys(changes).length) sandpack.updateFile(changes);
    flushRef.current();
  }, [files, sandpack, signature]);

  useEffect(() => {
    return listen((msg) => {
      if (msg.type === "done" || msg.type === "success") flushRef.current();
    });
  }, [listen]);

  return null;
}

function ReadyPreview({
  fileData,
  isGenerating,
  isImproving,
  statusLog,
  activeTab,
  device,
  previewError,
  setPreviewError,
  onFixError,
  readonlyHintId,
}: {
  fileData: FileData;
  isGenerating: boolean;
  isImproving: boolean;
  statusLog: StatusStep[];
  activeTab: ActiveTab;
  device: PreviewDevice;
  previewError: string | null;
  setPreviewError: (error: string | null) => void;
  onFixError: (error: string) => Promise<void>;
  readonlyHintId: string;
}) {
  const { sandpack, listen, dispatch } = useSandpack();
  const previewRef = useRef<SandpackPreviewRef>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const currentStepLabel = statusLog[statusLog.length - 1]?.label ?? "Generating…";

  useEffect(() => {
    unsubscribeRef.current = listen((msg) => {
      if (msg.type === "action" && "action" in msg && msg.action === "show-error") {
        const errMsg =
          "message" in msg && typeof msg.message === "string"
            ? msg.message
            : "An error occurred in the preview.";
        setPreviewError(summarizePreviewError(errMsg));
        return;
      }
      if (msg.type === "success" || (msg.type === "done" && !msg.compilatonError)) {
        setPreviewError(null);
      }
    });
    return () => unsubscribeRef.current?.();
  }, [listen, setPreviewError]);

  useEffect(() => {
    if (isGenerating) setPreviewError(null);
  }, [isGenerating, setPreviewError]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SandpackFileSync files={fileData.files} previewRef={previewRef} />
      {(isGenerating || isImproving) && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-violet-500/20 bg-background px-3 py-1.5">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-violet-700 motion-reduce:animate-none dark:text-violet-300" />
          <p className="min-w-0 text-xs text-foreground">
            {isImproving ? "Applying agent edits…" : currentStepLabel}
          </p>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <SandpackLayout
          className="drevo-preview-layout !h-full min-h-0 !flex-nowrap [&_.sp-file-explorer]:!h-full [&_.sp-file-explorer]:!min-w-0 [&_.sp-stack]:!h-full [&_.sp-stack]:!min-h-0 [&_.sp-stack]:!min-w-0"
          style={{ height: "100%", border: "none", borderRadius: 0, background: "transparent" }}
        >
          <TabsContent value="preview" keepMounted className="mt-0 h-full min-h-0 w-full">
            <div
              className={
                device === "mobile"
                  ? "relative mx-auto h-full min-h-0 w-full max-w-[390px] border-x border-border"
                  : "relative h-full min-h-0 w-full"
              }
            >
              <SandpackPreview
                ref={previewRef}
                className="!h-full"
                style={{ height: "100%" }}
                showOpenInCodeSandbox={false}
                showRefreshButton={false}
                showSandpackErrorOverlay={!previewError}
              />
              {sandpack.status === "running" && (
                <button
                  type="button"
                  aria-label="Refresh preview"
                  onClick={() => dispatch({ type: "refresh" })}
                  className="absolute bottom-3 right-3 z-10 inline-flex size-11 items-center justify-center rounded-full border border-border bg-popover text-popover-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RefreshCw className="size-4" />
                </button>
              )}
            </div>
          </TabsContent>
          <TabsContent value="code" keepMounted className="mt-0 flex h-full min-h-0 w-full flex-col">
            <p id={readonlyHintId} className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              Read-only. Describe a change in chat to edit this code.
            </p>
            <div className="flex min-h-0 flex-1" aria-describedby={readonlyHintId}>
              <SandpackFileExplorer
                className="!h-full"
                style={{ height: "100%", width: "min(11rem, 34%)", minWidth: 0, borderRight: "1px solid var(--border)" }}
              />
              <SandpackCodeEditor
                className="!h-full min-w-0 flex-1"
                style={{ height: "100%", flex: 1, minWidth: 0 }}
                showTabs
                showLineNumbers
                showInlineErrors
                closableTabs
                readOnly
                showReadOnly
              />
            </div>
          </TabsContent>
        </SandpackLayout>
      </div>
      {previewError && !isGenerating && !isImproving && activeTab === "preview" && (
        <div className="shrink-0 border-t border-destructive/30 bg-background px-3 py-3">
          <div className="flex flex-wrap items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div role="alert" className="min-w-0 flex-1">
              <p className="text-xs font-medium text-red-800 dark:text-red-200">Preview error</p>
              <p className="mt-1 break-words text-sm text-foreground">{previewError}</p>
            </div>
            <Button onClick={() => onFixError(previewError)} variant="destructive" className="h-11">
              <Bot className="size-3" />
              Fix with AI
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CodePanel({
  fileData,
  isGenerating,
  statusLog,
  onFixError,
  appTitle,
  isImproving,
  versions,
  versionsLoading,
  onRestoreVersion,
  focusMode,
  onToggleFocusMode,
  workspaceId,
  githubConnected,
  githubUsername,
  lastPush,
  onPushed,
  onGithubConnectionChange,
}: CodePanelProps) {
  const { resolvedTheme } = useTheme();
  const historyId = useId();
  const readonlyHintId = useId();
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const historyCloseRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("preview");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const isBusy = isGenerating || isImproving;
  const currentStepLabel = statusLog[statusLog.length - 1]?.label ?? "Generating…";

  useEffect(() => {
    if (fileData) setActiveTab("preview");
  }, [fileData]);

  useEffect(() => {
    if (!showHistory) return;
    historyCloseRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowHistory(false);
      historyButtonRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHistory]);

  const dependencyKey = dependencyKeyFor(fileData?.dependencies);
  const dependencies = useMemo(() => dependenciesFromKey(dependencyKey), [dependencyKey]);
  const customSetup = useMemo(() => ({ dependencies }), [dependencies]);
  const filePathKey = fileData ? Object.keys(fileData.files).sort().join("|") : "";

  const handleExportZip = async () => {
    if (isExporting || !fileData) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const projectFiles = buildProjectFiles({
        files: fileData.files,
        dependencies: fileData.dependencies,
        title: appTitle ?? fileData.title ?? null,
      });
      const zip = new JSZip();
      for (const [zipPath, content] of Object.entries(projectFiles)) {
        zip.file(zipPath, content);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportZipName(appTitle);
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = exportFailureMessage(error);
      setExportError(message);
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleQuickUpdate = async () => {
    if (isUpdating || isBusy || !fileData || !workspaceId || !lastPush) return;
    setIsUpdating(true);
    try {
      const outcome = await pushToGithub({
        workspaceId,
        mode: "existing",
        repoFullName: lastPush.fullName,
        branch: lastPush.branch,
        commitMessage: "Update from Drevo",
      });
      if (!outcome.ok) {
        if (outcome.error.code === "GITHUB_NOT_CONNECTED" || outcome.error.code === "GITHUB_TOKEN_INVALID") {
          onGithubConnectionChange(false, null);
        }
        toast.error(outcome.error.message);
        return;
      }
      onPushed({
        repoUrl: outcome.result.repoUrl,
        fullName: outcome.result.fullName || lastPush.fullName,
        branch: outcome.result.branch,
        pushedAt: new Date().toISOString(),
      });
      toast.success(outcome.result.unchanged ? "Already up to date on GitHub." : "GitHub updated.");
      if (outcome.result.trackingSaved === false) {
        toast.warning("GitHub was updated, but Drevo could not save push history. Check the repository before retrying.");
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const closeHistory = () => {
    setShowHistory(false);
    historyButtonRef.current?.focus();
  };

  return (
    <div className="@container/preview flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ActiveTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div data-preview-toolbar className="relative flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1">
          <TabsList variant="line" className="h-auto shrink-0 gap-0 rounded-none bg-transparent p-0">
            <TabsTrigger className="min-h-11 border-b-2" value="code">
              <Code2 className="size-3.5" />
              Code
            </TabsTrigger>
            <TabsTrigger className="min-h-11 border-b-2" value="preview">
              <Eye className="size-3.5" />
              Preview
            </TabsTrigger>
          </TabsList>

          <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
            <button
              ref={historyButtonRef}
              type="button"
              aria-label={versions.length > 0 ? `Version history, ${versions.length} saved` : "Version history"}
              aria-expanded={showHistory}
              aria-controls={historyId}
              aria-pressed={showHistory}
              onClick={() => setShowHistory((open) => !open)}
              className={`${iconButtonClass} w-auto gap-1.5 px-2 ${showHistory ? "bg-muted text-foreground" : ""}`}
            >
              <History className="size-4" />
              {versions.length > 0 && (
                <span className="rounded-sm bg-muted px-1 text-[10px] leading-4 text-foreground">{versions.length}</span>
              )}
            </button>

            <div role="group" aria-label="Preview width" className="flex items-center rounded-md border border-border p-0.5">
              <button
                type="button"
                aria-label="Desktop preview"
                aria-pressed={device === "desktop"}
                onClick={() => setDevice("desktop")}
                className={`${iconButtonClass} ${device === "desktop" ? "bg-muted text-foreground" : ""}`}
              >
                <Monitor className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Mobile preview"
                aria-pressed={device === "mobile"}
                onClick={() => setDevice("mobile")}
                className={`${iconButtonClass} ${device === "mobile" ? "bg-muted text-foreground" : ""}`}
              >
                <Smartphone className="size-4" />
              </button>
            </div>

            <button
              type="button"
              aria-label={focusMode ? "Show chat" : "Focus preview"}
              aria-pressed={focusMode}
              onClick={onToggleFocusMode}
              className={`${iconButtonClass} ${focusMode ? "bg-muted text-foreground" : ""}`}
            >
              {focusMode ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>

            <Button variant="ghost" className="h-11" onClick={handleExportZip} disabled={isExporting || !fileData}>
              {isExporting ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Download className="size-3.5" />}
              Download
            </Button>

            <GithubPushDialog
              workspaceId={workspaceId}
              appTitle={appTitle}
              fileDataPresent={Boolean(fileData)}
              disabled={isBusy}
              githubConnected={githubConnected}
              githubUsername={githubUsername}
              lastPush={lastPush}
              onPushed={onPushed}
              onConnectionChange={onGithubConnectionChange}
            />

            {lastPush && (
              <Button
                variant="ghost"
                className="h-11"
                onClick={handleQuickUpdate}
                disabled={isUpdating || isBusy || !fileData || !workspaceId}
                title={`Push latest code to ${lastPush.fullName} (${lastPush.branch})`}
              >
                {isUpdating ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Upload className="size-3.5" />}
                Update
              </Button>
            )}
          </div>

          {showHistory && (
            <div
              id={historyId}
              role="dialog"
              aria-label="Version history"
              className="absolute right-0 top-full z-30 mt-1 w-[min(18rem,calc(100cqw-0.5rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-1">
                <p className="text-xs font-semibold text-foreground">Version history</p>
                <button
                  ref={historyCloseRef}
                  type="button"
                  aria-label="Close version history"
                  onClick={closeHistory}
                  className={iconButtonClass}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto p-1.5">
                {versionsLoading ? (
                  <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">Loading…</p>
                ) : versions.length === 0 ? (
                  <p className="px-2.5 py-4 text-center text-xs text-muted-foreground">
                    No versions yet. Each AI edit saves one here.
                  </p>
                ) : (
                  versions.map((version) => (
                    <div key={version.id} className="rounded-lg px-2.5 py-2 hover:bg-muted/50">
                      <p className="line-clamp-2 text-xs leading-relaxed text-foreground">
                        {version.summary ?? "Untitled version"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })} · {version.fileCount} file
                          {version.fileCount === 1 ? "" : "s"}
                        </span>
                        <button
                          type="button"
                          disabled={isBusy || restoringId !== null}
                          aria-busy={restoringId === version.id}
                          onClick={async () => {
                            setRestoringId(version.id);
                            await onRestoreVersion(version.id);
                            setRestoringId(null);
                            closeHistory();
                          }}
                          className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-xs font-medium text-violet-800 hover:bg-violet-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 dark:text-violet-200"
                        >
                          {restoringId === version.id && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />}
                          Restore
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                Restoring is free and reversible.
              </p>
            </div>
          )}
        </div>

        {exportError && (
          <p role="alert" className="shrink-0 border-b border-destructive/30 bg-background px-3 py-2 text-sm text-red-800 dark:text-red-200">
            {exportError}
          </p>
        )}

        {!fileData ? (
          <div data-preview-ready="false" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            {isGenerating || isImproving ? (
              <>
                <span className="motion-reduce:hidden" aria-hidden>
                  <RingLoader color="#a78bfa" size={64} speedMultiplier={0.8} />
                </span>
                <span className="hidden size-16 rounded-full border-4 border-violet-400 motion-reduce:inline-block" aria-hidden />
                <div className="flex flex-col items-center gap-1.5">
                  <p className="text-sm font-medium text-foreground">{isImproving ? "Applying agent edits…" : currentStepLabel}</p>
                  <p className="text-xs text-muted-foreground">This usually takes 10–20 seconds</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {activeTab === "code"
                  ? "Project files appear after your first successful build."
                  : "Your app preview appears after your first successful build."}
              </p>
            )}
          </div>
        ) : (
          <div data-preview-ready="true" data-preview-paths={filePathKey} className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Empty and ready are different mounts. A path-only key would reuse the
                placeholder client when both are /App.js, and Sandpack drops a delayed
                update while that client is still compiling. */}
            <SandpackProvider
              key={filePathKey}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              style={{ height: "100%" }}
              template="react"
              theme={resolvedTheme === "light" ? "light" : "dark"}
              files={fileData.files}
              customSetup={customSetup}
              options={SANDPACK_OPTIONS}
            >
              <ReadyPreview
                fileData={fileData}
                isGenerating={isGenerating}
                isImproving={isImproving}
                statusLog={statusLog}
                activeTab={activeTab}
                device={device}
                previewError={previewError}
                setPreviewError={setPreviewError}
                onFixError={onFixError}
                readonlyHintId={readonlyHintId}
              />
            </SandpackProvider>
          </div>
        )}
      </Tabs>
    </div>
  );
}
