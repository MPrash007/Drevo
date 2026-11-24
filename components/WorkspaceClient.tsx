"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getVersions, restoreVersion } from "@/actions/versions";
import type { FileData, Message, StatusStep, WorkspaceData } from "@/types/workspace";
import type { VersionSummary } from "@/types/version";
import { defaultAiSelection, fetchAiSettings, type AiSelection, type AiSettings } from "@/lib/ai-providers";
import { AiProviderControls } from "./AiProviderControls";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { MobileBlocker } from "./MobileBlocker";

interface Props {
  initialPrompt: string | null;
  initialSelection?: AiSelection;
  launchToken?: string;
  workspace: WorkspaceData | null;
  orgId: string;
  userRole: "OWNER" | "ADMIN" | "MEMBER";
  githubConnected: boolean;
  githubUsername: string | null;
}

function available(selection: AiSelection | null, settings: AiSettings | null) {
  if (!selection || !settings || (selection.scope === "personal" && !settings.allowPersonal)) return false;
  const current = settings[selection.scope];
  return current?.provider === selection.provider && current.model === selection.model;
}

export function WorkspaceClient({ initialPrompt, initialSelection, launchToken, workspace, orgId, userRole, githubConnected: initialConnected, githubUsername: initialUsername }: Props) {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState(workspace?.id ?? null);
  const revision = useRef(workspace?.revision ?? 0);
  const [messages, setMessages] = useState<Message[]>(() => Array.isArray(workspace?.messages) ? workspace.messages : []);
  const [fileData, setFileData] = useState<FileData | null>(() => {
    const saved = workspace?.fileData as FileData | null | undefined;
    return saved?.files ? saved : null;
  });
  const [statusLog, setStatusLog] = useState<StatusStep[]>([]);
  const [running, setRunning] = useState(false);
  const runRef = useRef<AbortController | null>(null);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string>();
  const [providersOpen, setProvidersOpen] = useState(false);
  const [override, setOverride] = useState<AiSelection | null>(initialSelection ?? null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(!!workspace);
  const [githubConnected, setGithubConnected] = useState(initialConnected);
  const [githubUsername, setGithubUsername] = useState(initialUsername);
  const [lastPush, setLastPush] = useState(() => workspace?.githubRepoUrl ? {
    repoUrl: workspace.githubRepoUrl,
    fullName: workspace.githubRepoFullName ?? workspace.githubRepoUrl,
    branch: workspace.githubBranch ?? "main",
    pushedAt: workspace.lastPushedAt ?? "",
  } : null);
  const [focusMode, setFocusMode] = useState(false);
  const [chatWidth, setChatWidth] = useState(320);
  const resizing = useRef<{ x: number; width: number } | null>(null);
  const selected = override ?? settings?.selection ?? defaultAiSelection(settings);
  const staleSelection = !!selected && !available(selected, settings);
  const canRun = available(selected, settings) && (!!workspaceId || userRole !== "MEMBER");
  const blockedReason = !workspaceId && userRole === "MEMBER"
    ? "Only organization owners and admins can start a new project."
    : null;

  function explainBlockedRun() {
    if (blockedReason) toast.error(blockedReason);
    else setProvidersOpen(true);
  }

  const loadSettings = useCallback((signal?: AbortSignal) => fetchAiSettings({ orgId, workspaceId: workspaceId ?? undefined }, signal), [orgId, workspaceId]);
  const refreshSettings = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await loadSettings());
      setSettingsError(undefined);
    } catch (error) {
      setSettings(null);
      setSettingsError(error instanceof Error ? error.message : "Could not load AI connections.");
      throw error;
    } finally {
      setLoading(false);
    }
  }, [loadSettings]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSettings(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) { setSettings(value); setSettingsError(undefined); }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSettings(null);
          setSettingsError(error instanceof Error ? error.message : "Could not load AI connections.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadSettings]);
  useEffect(() => () => runRef.current?.abort(), []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = Number(localStorage.getItem("drevo:chat-width"));
        if (saved >= 240 && saved <= 560) setChatWidth(saved);
      } catch { /* Local storage can be unavailable. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const refreshVersions = useCallback(async (id: string) => {
    setVersionsLoading(true);
    try { setVersions(await getVersions(id)); }
    catch { /* History is optional. */ }
    finally { setVersionsLoading(false); }
  }, []);
  useEffect(() => {
    if (!workspaceId) return;
    let ignore = false;
    void getVersions(workspaceId).then((value) => { if (!ignore) setVersions(value); })
      .catch(() => {}).finally(() => { if (!ignore) setVersionsLoading(false); });
    return () => { ignore = true; };
  }, [workspaceId]);

  async function chooseSelection(selection: AiSelection) {
    if (!workspaceId) { setOverride(selection); return; }
    try {
      const response = await fetch("/api/ai/providers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select", orgId, workspaceId, selection }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message);
      setSettings((current) => current && { ...current, selection });
      setOverride(null);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Could not save the selected model.");
      void refreshSettings().catch(() => {});
    }
  }

  async function run(prompt: string, imageUrl?: string, prior = messages) {
    if (runRef.current || !canRun || !selected) return false;
    const controller = new AbortController();
    runRef.current = controller;
    const conversation: Message[] = [...prior, { role: "user", content: prompt, ...(imageUrl ? { imageUrl } : {}) }];
    setMessages([...conversation, { role: "assistant", content: "" }]);
    setRunning(true);
    setStatusLog([{ label: `Working with ${selected.model}`, status: "running" }]);
    let completed = false;
    let started = false;
    try {
      const response = await fetch("/api/improve", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          orgId, workspaceId, revision: revision.current, userRequest: prompt, imageUrl, messages: conversation,
          selection: selected,
        }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        if (response.status === 409 || response.status === 403) {
          setOverride(null);
          void refreshSettings().catch(() => {});
        }
        throw new Error(data?.message ?? "Could not start the AI run.");
      }
      started = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (!completed) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        const events = pending.split("\n\n");
        pending = events.pop() ?? "";
        for (const line of events) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "status") {
            setStatusLog((steps) => [...steps.map(({ label }) => ({ label, status: "done" as const })), { label: event.message, status: "running" }]);
          }
          if (event.type === "done") {
            completed = true;
            if (event.fileData) setFileData(event.fileData);
            if (typeof event.revision === "number") revision.current = event.revision;
            if (event.workspaceId && event.workspaceId !== workspaceId) {
              window.history.replaceState(null, "", `/workspace?id=${encodeURIComponent(event.workspaceId)}`);
              setWorkspaceId(event.workspaceId);
            } else if (workspaceId && event.fileData) {
              void refreshVersions(workspaceId);
            }
            if (workspaceId || event.workspaceId) {
              setSettings((current) => current && { ...current, selection: selected });
              setOverride(null);
            }
            setMessages([...conversation, { role: "assistant", content: event.summary || "Done." }]);
            if (event.partial) toast.info("Partially applied. Ask the model to continue.");
            break;
          }
        }
      }
      if (!completed) throw new Error("Connection closed before completion. Reload to check the project before retrying.");
    } catch (error) {
      setMessages(messages);
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "AI run failed.");
      if (started) router.refresh();
    } finally {
      runRef.current = null;
      setRunning(false);
      setStatusLog([]);
    }
    return completed;
  }

  const restore = async (id: string) => {
    if (!workspaceId || runRef.current) return;
    try {
      const detail = await restoreVersion(workspaceId, id, revision.current);
      revision.current = detail.revision;
      setFileData(detail.fileData);
      void refreshVersions(workspaceId);
      toast.success("Version restored.");
    } catch { toast.error("Could not restore the version. Reload and try again."); }
  };

  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!resizing.current) return;
    setChatWidth(Math.min(560, Math.max(240, resizing.current.width + event.clientX - resizing.current.x)));
  }
  return (
    <>
      <div className="md:hidden"><MobileBlocker /></div>
      <div className="hidden h-[calc(100vh-3.5rem)] overflow-hidden bg-background md:flex">
        {!focusMode && (
          <ChatPanel
            initialPrompt={initialPrompt} messages={messages} isGenerating={running && !fileData} isImproving={running && !!fileData}
            statusLog={statusLog} orgId={orgId}
            appTitle={fileData?.title ?? workspace?.title ?? null} width={chatWidth}
            canRun={canRun}
            onBlockedSubmit={explainBlockedRun}
            launch={launchToken && initialPrompt && initialSelection && selected === initialSelection
              ? { token: launchToken, prompt: initialPrompt, orgId, selection: initialSelection }
              : undefined}
            providerControls={<>
              <AiProviderControls settings={settings} selection={staleSelection ? null : selected}
                loading={loading} error={settingsError} disabled={running} open={providersOpen} onOpenChange={setProvidersOpen}
                onSelect={(selection) => void chooseSelection(selection)} onRefresh={refreshSettings} />
              {blockedReason && <p className="mb-2 text-xs text-muted-foreground">{blockedReason}</p>}
              {settings && staleSelection && <p role="status" className="mb-2 text-xs text-muted-foreground">Your selected model is no longer available. Choose a connection to confirm a replacement.</p>}
            </>}
            onGenerate={run}
            onStop={() => runRef.current?.abort()}
            onEditMessage={(index, prompt) => void run(prompt, messages[index]?.imageUrl, messages.slice(0, index))}
            onRegenerate={() => {
              const index = messages.findLastIndex((m) => m.role === "user");
              if (index >= 0) void run(messages[index].content, messages[index].imageUrl, messages.slice(0, index));
            }}
          />
        )}
        {!focusMode && (
          <div role="separator" aria-orientation="vertical" aria-label="Resize chat panel"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              resizing.current = { x: event.clientX, width: chatWidth };
            }}
            onPointerMove={resize}
            onPointerUp={() => {
              resizing.current = null;
              try { localStorage.setItem("drevo:chat-width", String(chatWidth)); } catch { /* Optional preference. */ }
            }}
            onPointerCancel={() => { resizing.current = null; }}
            className="w-1.5 shrink-0 cursor-col-resize touch-none bg-border hover:bg-violet-500/40"
          />
        )}
        <CodePanel fileData={fileData} appTitle={fileData?.title ?? workspace?.title ?? null}
          isGenerating={running && !fileData} isImproving={running && !!fileData} statusLog={statusLog}
          onFixError={async (error) => {
            if (!canRun) {
              setFocusMode(false);
              explainBlockedRun();
              return;
            }
            await run(`Fix this preview error:\n\n${error}`);
          }}
          versions={versions} versionsLoading={versionsLoading} onRestoreVersion={restore}
          focusMode={focusMode} onToggleFocusMode={() => setFocusMode((mode) => !mode)}
          workspaceId={workspaceId} githubConnected={githubConnected} githubUsername={githubUsername}
          lastPush={lastPush} onPushed={setLastPush} onGithubConnectionChange={(connected, username) => {
            setGithubConnected(connected); setGithubUsername(username);
          }}
        />
      </div>
    </>
  );
}
