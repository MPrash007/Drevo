"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getVersions, restoreVersion } from "@/actions/versions";
import type { FileData, Message, StatusStep, WorkspaceData } from "@/types/workspace";
import type { VersionSummary } from "@/types/version";
import { defaultAiSelection, fetchAiSettings, isAiSelectionAvailable, type AiSelection, type AiSettings } from "@/lib/ai-providers";
import { WORKSPACE_VIEWPORT_QUERY, workspaceFitsViewport } from "@/lib/workspace-viewport";
import { Button } from "@/components/ui/button";
import { AiProviderControls } from "./AiProviderControls";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { MobileBlocker } from "./MobileBlocker";

interface Props {
  initialPrompt: string | null;
  initialSelection?: AiSelection;
  launchToken?: string;
  workspace: WorkspaceData | null;
  userId: string;
  orgId: string;
  userRole: "OWNER" | "ADMIN" | "MEMBER";
  githubConnected: boolean;
  githubUsername: string | null;
}

export const CHAT_MIN_WIDTH = 240;
export const CHAT_MAX_WIDTH = 560;
export const PREVIEW_MIN_WIDTH = 320;
export const SPLITTER_LAYOUT_WIDTH = 44;
const CHAT_WIDTH_KEY = "drevo:chat-width";

type Viewport = "pending" | "fit" | "blocked";
type RunGate = "start" | "skip" | "viewport";

export function composerStoragePrefix(userId: string, orgId: string, workspaceId: string | null, launchToken?: string) {
  const scope = workspaceId ?? (launchToken ? `launch:${launchToken.slice(0, 64)}` : "new");
  return `drevo:composer:${userId}:${orgId}:${scope}`;
}

export function chatWidthBounds(containerWidth: number) {
  const room = Math.floor(containerWidth - PREVIEW_MIN_WIDTH - SPLITTER_LAYOUT_WIDTH);
  return { min: CHAT_MIN_WIDTH, max: Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, room)) };
}

export function clampChatWidth(requested: number, containerWidth: number) {
  const { min, max } = chatWidthBounds(containerWidth);
  const width = Number.isFinite(requested) ? requested : min;
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** Consume only after the viewport check, so a hidden or short window cannot start a charge. */
export function gateWorkspaceRun(input: {
  fits: boolean;
  alreadyRunning: boolean;
  canRun: boolean;
  hasSelection: boolean;
  consumeLaunch?: () => boolean;
}): RunGate {
  if (input.alreadyRunning || !input.canRun || !input.hasSelection) return "skip";
  if (!input.fits) return "viewport";
  if (input.consumeLaunch && !input.consumeLaunch()) return "skip";
  return "start";
}

function readStorage(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch { /* Storage can be unavailable. */ }
}

function formatRunError(error: unknown) {
  const detail = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "The run failed before it finished.";
  return detail;
}

const VIEWPORT_ERROR = "This window is too small to start a run. Widen it to at least 768 by 500 pixels, then try again.";

export function WorkspaceClient({ initialPrompt, initialSelection, launchToken, workspace, userId, orgId, userRole, githubConnected: initialConnected, githubUsername: initialUsername }: Props) {
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
  const [selecting, setSelecting] = useState(false);
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
  const [containerWidth, setContainerWidth] = useState(1280);
  const [viewport, setViewport] = useState<Viewport>("pending");
  const [composer, setComposer] = useState(initialPrompt ?? "");
  const [attachment, setAttachment] = useState<string>();
  const [editing, setEditing] = useState<{ index: number; draft: string } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const messageCount = useRef(messages.length);
  const composerDirty = useRef(false);
  const resizing = useRef<{ x: number; width: number; pointerId: number } | null>(null);
  const widthRef = useRef(chatWidth);
  const shellRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef("");
  const selected = override ?? settings?.selection ?? defaultAiSelection(settings);
  const selectionAvailable = isAiSelectionAvailable(selected, settings);
  const staleSelection = !!selected && !selectionAvailable;
  const canRun = selectionAvailable && !selecting && (!!workspaceId || userRole !== "MEMBER");
  const blockedReason = !workspaceId && userRole === "MEMBER"
    ? "Only organization owners and admins can start a new project."
    : null;
  const composerKey = composerStoragePrefix(userId, orgId, workspaceId, launchToken);
  const draftKey = `${composerKey}:draft`;
  const imageKey = `${composerKey}:image`;
  const editKey = `${composerKey}:edit`;
  const errorKey = `${composerKey}:error`;
  const appTitle = fileData?.title ?? workspace?.title ?? null;
  const widthBounds = chatWidthBounds(containerWidth);

  function explainBlockedRun() {
    if (blockedReason) toast.error(blockedReason);
    else setProvidersOpen(true);
  }

  function rememberError(message: string | null) {
    setRunError(message);
    writeStorage(errorKey, message);
  }

  function setWidth(next: number) {
    widthRef.current = next;
    setChatWidth(next);
  }

  function persistWidth(width = widthRef.current) {
    try { localStorage.setItem(CHAT_WIDTH_KEY, String(width)); } catch { /* Optional preference. */ }
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
    const onBlur = () => {
      if (!resizing.current) return;
      resizing.current = null;
      document.body.style.cursor = cursorRef.current;
      try { localStorage.setItem(CHAT_WIDTH_KEY, String(widthRef.current)); } catch { /* Optional preference. */ }
    };
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      if (resizing.current) document.body.style.cursor = cursorRef.current;
    };
  }, []);

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
    const media = window.matchMedia(WORKSPACE_VIEWPORT_QUERY);
    const apply = () => setViewport(media.matches ? "fit" : "blocked");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => { messageCount.current = messages.length; }, [messages.length]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const savedDraft = readStorage(draftKey);
      if (savedDraft && !composerDirty.current) setComposer(savedDraft);
      const savedImage = readStorage(imageKey);
      if (savedImage) setAttachment(savedImage);
      const savedError = readStorage(errorKey);
      if (savedError) setRunError(savedError);
      const savedEdit = readStorage(editKey);
      if (!savedEdit) return;
      try {
        const parsed = JSON.parse(savedEdit) as { index?: unknown; draft?: unknown };
        if (typeof parsed.index === "number" && parsed.index >= 0 && parsed.index < messageCount.current && typeof parsed.draft === "string") {
          setEditing({ index: parsed.index, draft: parsed.draft });
        } else {
          writeStorage(editKey, null);
        }
      } catch { /* Ignore a damaged edit draft. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [draftKey, imageKey, editKey, errorKey]);

  useEffect(() => {
    if (viewport !== "fit") return;
    const shell = shellRef.current;
    if (!shell) return;
    const applyWidth = (next: number) => {
      widthRef.current = next;
      setChatWidth(next);
    };
    const apply = () => {
      const width = shell.clientWidth;
      setContainerWidth(width);
      applyWidth(clampChatWidth(widthRef.current, width));
    };
    try {
      const saved = Number(localStorage.getItem(CHAT_WIDTH_KEY));
      if (Number.isFinite(saved) && saved >= CHAT_MIN_WIDTH) applyWidth(clampChatWidth(saved, shell.clientWidth));
    } catch { /* Local storage can be unavailable. */ }
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [viewport]);

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
    return () => { ignore = true; }
  }, [workspaceId]);

  async function chooseSelection(selection: AiSelection) {
    if (!workspaceId) { setOverride(selection); return; }
    setSelecting(true);
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
    } finally {
      setSelecting(false);
    }
  }

  async function run(prompt: string, imageUrl?: string, prior = messages, consumeLaunch?: () => boolean) {
    const decision = gateWorkspaceRun({
      fits: workspaceFitsViewport(),
      alreadyRunning: !!runRef.current,
      canRun,
      hasSelection: !!selected,
      consumeLaunch,
    });
    if (decision === "viewport") {
      rememberError(VIEWPORT_ERROR);
      return false;
    }
    if (decision !== "start" || !selected) return false;
    const controller = new AbortController();
    runRef.current = controller;
    const conversation: Message[] = [...prior, { role: "user", content: prompt, ...(imageUrl ? { imageUrl } : {}) }];
    setMessages([...conversation, { role: "assistant", content: "" }]);
    setRunning(true);
    rememberError(null);
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
      if (!controller.signal.aborted) {
        rememberError(formatRunError(error));
        toast.error(error instanceof Error && error.message ? error.message : "AI run failed.");
      }
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

  function updateComposer(value: string) {
    composerDirty.current = true;
    setComposer(value);
    writeStorage(draftKey, value);
  }

  function updateAttachment(url: string | undefined) {
    setAttachment(url);
    writeStorage(imageKey, url ?? null);
  }

  function updateEditing(value: { index: number; draft: string } | null) {
    setEditing(value);
    writeStorage(editKey, value ? JSON.stringify(value) : null);
  }

  function rememberDraft(prompt: string, image?: string) {
    writeStorage(draftKey, prompt);
    writeStorage(imageKey, image ?? null);
  }

  function finishSend(ok: boolean) {
    if (!ok) return;
    setComposer("");
    setAttachment(undefined);
    writeStorage(draftKey, null);
    writeStorage(imageKey, null);
  }

  function stopRun() {
    runRef.current?.abort();
  }

  function endDrag(pointerId?: number) {
    const drag = resizing.current;
    if (!drag || (pointerId !== undefined && pointerId !== drag.pointerId)) return;
    resizing.current = null;
    document.body.style.cursor = cursorRef.current;
    persistWidth();
  }

  function onSplitterPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (resizing.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.focus({ preventScroll: true });
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cursorRef.current = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    resizing.current = { x: event.clientX, width: widthRef.current, pointerId: event.pointerId };
  }

  function onSplitterPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = resizing.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const container = shellRef.current?.clientWidth ?? containerWidth;
    setWidth(clampChatWidth(drag.width + event.clientX - drag.x, container));
  }

  function onSplitterKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const container = shellRef.current?.clientWidth ?? containerWidth;
    const step = event.shiftKey ? 48 : 16;
    let next = widthRef.current;
    if (event.key === "ArrowLeft") next -= step;
    else if (event.key === "ArrowRight") next += step;
    else if (event.key === "Home") next = CHAT_MIN_WIDTH;
    else if (event.key === "End") next = container;
    else return;
    event.preventDefault();
    const clamped = clampChatWidth(next, container);
    setWidth(clamped);
    persistWidth(clamped);
  }

  const launch = launchToken && initialPrompt && initialSelection && selected === initialSelection
    ? { token: launchToken, prompt: initialPrompt, orgId, selection: initialSelection }
    : undefined;
  const statusLabel = statusLog.at(-1)?.label;

  if (viewport === "pending") {
    return (
      <div className="h-[calc(100dvh-4rem)] bg-background" aria-busy="true">
        <p className="sr-only">Checking whether this window can open the workspace.</p>
      </div>
    );
  }

  if (viewport === "blocked") {
    return (
      <MobileBlocker running={running} status={statusLabel} error={runError} onStop={stopRun} />
    );
  }

  return (
    <div ref={shellRef} className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden bg-background">
      {focusMode && (
        <h1 className="sr-only">{appTitle ?? "Workspace"}</h1>
      )}
      {focusMode && (running || runError) && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-3 py-2">
          {running ? (
            <p role="status" className="min-w-0 truncate text-sm text-foreground">{statusLabel ?? "Working"}</p>
          ) : (
            <p role="alert" className="min-w-0 text-sm text-destructive">{runError}</p>
          )}
          {running && (
            <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={stopRun}>
              Stop
            </Button>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {!focusMode && (
          <ChatPanel
            input={composer}
            onInputChange={updateComposer}
            image={attachment}
            onImageChange={updateAttachment}
            editing={editing}
            onEditingChange={updateEditing}
            runError={runError}
            onDismissError={() => rememberError(null)}
            onRememberDraft={rememberDraft}
            onSendFinished={finishSend}
            draftStorageKey={draftKey}
            messages={messages}
            isGenerating={running && !fileData}
            isImproving={running && !!fileData}
            statusLog={statusLog}
            orgId={orgId}
            appTitle={appTitle}
            width={chatWidth}
            canRun={canRun}
            onBlockedSubmit={explainBlockedRun}
            launch={launch}
            providerControls={<>
              <AiProviderControls settings={settings} selection={staleSelection ? null : selected}
                loading={loading} error={settingsError} disabled={running || selecting} open={providersOpen} onOpenChange={setProvidersOpen}
                onSelect={(selection) => void chooseSelection(selection)} onRefresh={refreshSettings} />
              {blockedReason && <p className="mb-2 text-xs text-muted-foreground">{blockedReason}</p>}
              {settings && staleSelection && <p role="status" className="mb-2 text-xs text-muted-foreground">Your selected model is no longer available. Choose a connection to confirm a replacement.</p>}
            </>}
            onGenerate={(prompt, imageUrl, consumeLaunch) => run(prompt, imageUrl, messages, consumeLaunch)}
            onStop={stopRun}
            onEditMessage={(index, prompt) => run(prompt, messages[index]?.imageUrl, messages.slice(0, index))}
            onRegenerate={() => {
              const index = messages.findLastIndex((m) => m.role === "user");
              if (index >= 0) return run(messages[index].content, messages[index].imageUrl, messages.slice(0, index));
              return Promise.resolve(false);
            }}
          />
        )}
        {!focusMode && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel"
            aria-valuemin={widthBounds.min}
            aria-valuemax={widthBounds.max}
            aria-valuenow={chatWidth}
            aria-valuetext={`${chatWidth} pixels`}
            aria-controls="workspace-chat"
            tabIndex={0}
            title="Drag or use the arrow keys. The preview keeps at least 320 pixels."
            onPointerDown={onSplitterPointerDown}
            onPointerMove={onSplitterPointerMove}
            onPointerUp={(event) => endDrag(event.pointerId)}
            onPointerCancel={(event) => endDrag(event.pointerId)}
            onLostPointerCapture={(event) => endDrag(event.pointerId)}
            onBlur={() => endDrag()}
            onKeyDown={onSplitterKeyDown}
            className="relative z-10 flex w-6 shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-transparent outline-none hover:bg-violet-500/15 focus-visible:bg-violet-500/20 focus-visible:ring-2 focus-visible:ring-violet-500/60 [@media(pointer:coarse)]:w-11"
          >
            <span aria-hidden="true" className="w-px bg-border" />
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CodePanel fileData={fileData} appTitle={appTitle}
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
      </div>
    </div>
  );
}
