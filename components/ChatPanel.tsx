"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Paperclip, Loader2, X, Square, Copy, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import type { Message, StatusStep } from "@/types/workspace";
import { BrandTitle } from "./reusables";
import { consumeAiLaunch } from "@/lib/ai-launch-intent";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { workspaceFitsViewport } from "@/lib/workspace-viewport";

interface EditDraft {
  index: number;
  draft: string;
}

interface Props {
  messages: Message[];
  isGenerating: boolean;
  isImproving: boolean;
  statusLog: StatusStep[];
  canRun: boolean;
  onBlockedSubmit: () => void;
  launch?: Parameters<typeof consumeAiLaunch>[1];
  draftStorageKey: string;
  providerControls: ReactNode;
  input: string;
  onInputChange: (value: string) => void;
  image?: string;
  onImageChange: (url: string | undefined) => void;
  editing: EditDraft | null;
  onEditingChange: (value: EditDraft | null) => void;
  runError: string | null;
  onDismissError: () => void;
  onRememberDraft: (prompt: string, image?: string) => void;
  onSendFinished: (ok: boolean) => void;
  onGenerate: (prompt: string, imageUrl: string | undefined, consumeLaunch: () => boolean) => Promise<boolean>;
  onRegenerate: () => void;
  onEditMessage: (index: number, content: string) => Promise<boolean>;
  onStop: () => void;
  orgId: string;
  appTitle: string | null;
  width: number;
}

export function launchDraft(stored: string | null, input: string) {
  return stored === null ? input : stored;
}

export function launchMayStart(input: {
  fits: boolean;
  canRun: boolean;
  busy: boolean;
  uploading: boolean;
  draft: string;
  prompt: string;
}) {
  return input.fits
    && input.canRun
    && !input.busy
    && !input.uploading
    && input.draft === input.prompt
    && input.prompt.length > 0;
}

function readStoredDraft(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

const coarseTarget = "size-9 [@media(pointer:coarse)]:size-11";

export function ChatPanel({
  messages, isGenerating, isImproving, statusLog, canRun, onBlockedSubmit, launch, draftStorageKey, providerControls,
  input, onInputChange, image, onImageChange, editing, onEditingChange, runError, onDismissError,
  onRememberDraft, onSendFinished, onGenerate, onRegenerate, onEditMessage, onStop, orgId, appTitle, width,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const editField = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const busy = isGenerating || isImproving;
  const headingId = "workspace-chat-heading";
  const errorId = "workspace-run-error";

  useEffect(() => {
    const el = scroll.current;
    if (!el || !pinned.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [messages]);

  const editingIndex = editing?.index ?? null;
  useEffect(() => {
    if (editingIndex !== null) editField.current?.focus();
  }, [editingIndex]);

  function onLogScroll() {
    const el = scroll.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    pinned.current = atBottom;
    setShowJump((current) => (current === !atBottom ? current : !atBottom));
  }

  function jumpToLatest() {
    const el = scroll.current;
    if (!el) return;
    pinned.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }

  function consumeFor(requireLaunch: boolean) {
    if (!launch) return !requireLaunch;
    try {
      const consumed = consumeAiLaunch(sessionStorage, launch);
      return requireLaunch ? consumed : true;
    } catch {
      return !requireLaunch;
    }
  }

  async function submit(requireLaunch = false) {
    if (busy || uploading || !input.trim()) return;
    if (!canRun) {
      onBlockedSubmit();
      return;
    }
    if (!workspaceFitsViewport()) return;
    const prompt = input.trim();
    const attached = image;
    pinned.current = true;
    onRememberDraft(prompt, attached);
    const ok = await onGenerate(prompt, attached, () => consumeFor(requireLaunch));
    onSendFinished(ok);
  }

  const submitLaunch = useEffectEvent((intent: NonNullable<Props["launch"]>) => {
    const draft = launchDraft(readStoredDraft(draftStorageKey), input);
    if (!launchMayStart({
      fits: workspaceFitsViewport(),
      canRun,
      busy,
      uploading,
      draft,
      prompt: intent.prompt,
    })) return;
    if (draft !== input) return;
    void submit(true);
  });

  useEffect(() => {
    if (!launch || !canRun) return;
    const frame = requestAnimationFrame(() => submitLaunch(launch));
    return () => cancelAnimationFrame(frame);
  }, [launch, canRun]);

  async function upload(selected?: File) {
    if (!selected) return;
    if (!Object.hasOwn(ATTACHMENT_TYPES, selected.type)) { toast.error("Use a PNG, JPEG, WebP, or GIF image."); return; }
    if (selected.size > MAX_ATTACHMENT_BYTES) { toast.error("Images must be 4 MB or smaller."); return; }
    setUploading(true);
    try {
      const response = await fetch(`/api/attachments?${new URLSearchParams({ orgId })}`, {
        method: "POST", headers: { "Content-Type": selected.type }, body: selected,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.url !== "string") throw new Error(data?.message ?? "Could not upload the image.");
      onImageChange(data.url);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not upload the image."); }
    finally { setUploading(false); }
  }

  async function resendEdit() {
    if (!editing || busy || !canRun || !editing.draft.trim()) return;
    if (!workspaceFitsViewport()) return;
    pinned.current = true;
    const ok = await onEditMessage(editing.index, editing.draft.trim());
    if (ok) onEditingChange(null);
  }

  return (
    <aside id="workspace-chat" aria-labelledby={headingId} className="flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-card" style={{ width }}>
      <div className="min-w-0 border-b border-border px-3 py-3">
        <h1 id={headingId} className="truncate font-serif text-base font-semibold tracking-tight">
          <BrandTitle>{appTitle ?? "New project"}</BrandTitle>
        </h1>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroll}
          role="log"
          aria-labelledby={headingId}
          aria-busy={busy || undefined}
          onScroll={onLogScroll}
          className="h-full space-y-5 overflow-y-auto overscroll-y-contain px-3 py-4"
        >
          {!messages.length && <p className="py-5 text-center text-sm text-muted-foreground">Describe the app you want to build.</p>}
          {messages.map((message, index) => (
            <div key={index} className={message.role === "user" ? "min-w-0 space-y-2 rounded-lg bg-muted p-3" : "min-w-0 space-y-2 px-1"}>
              {editing?.index === index ? (
                <>
                  <label className="block text-xs text-muted-foreground" htmlFor={`edit-prompt-${index}`}>Edit prompt</label>
                  <textarea
                    ref={editField}
                    id={`edit-prompt-${index}`}
                    value={editing.draft}
                    maxLength={40000}
                    onChange={(event) => {
                      onEditingChange({ index, draft: event.target.value });
                      if (runError) onDismissError();
                    }}
                    className="w-full rounded border border-border bg-background p-2 text-base text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" className="min-h-11 [@media(pointer:fine)]:min-h-8" disabled={busy || !canRun || !editing.draft.trim()} onClick={() => void resendEdit()}>Resend</Button>
                    <Button type="button" size="sm" variant="ghost" className="min-h-11 [@media(pointer:fine)]:min-h-8" onClick={() => { onEditingChange(null); onDismissError(); }}>Cancel</Button>
                  </div>
                </>
              ) : (
                <>
                  {message.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={message.imageUrl} alt="Prompt attachment" className="max-h-40 rounded-md object-contain" />
                  )}
                  {message.content && <div className="min-w-0 overflow-x-auto break-words text-sm text-foreground [&_p]:mb-2"><ReactMarkdown>{message.content}</ReactMarkdown></div>}
                  {message.content && !busy && (
                    <div className="flex gap-1" role="group" aria-label="Message actions">
                      <Button variant="ghost" size="icon" className={coarseTarget} aria-label="Copy message" onClick={() => {
                        void navigator.clipboard.writeText(message.content).then(() => toast.success("Copied.")).catch(() => toast.error("Copy failed."));
                      }}><Copy className="size-3.5" /></Button>
                      {message.role === "user" && <Button variant="ghost" size="icon" className={coarseTarget} aria-label="Edit prompt" disabled={!canRun} onClick={() => onEditingChange({ index, draft: message.content })}><Pencil className="size-3.5" /></Button>}
                      {message.role === "assistant" && index === messages.length - 1 && <Button variant="ghost" size="icon" className={coarseTarget} aria-label="Regenerate response" disabled={!canRun} onClick={() => { pinned.current = true; onRegenerate(); }}><RotateCcw className="size-3.5" /></Button>}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        {showJump && (
          <Button type="button" variant="outline" size="sm" className="absolute inset-x-3 bottom-2 min-h-11 shadow-md shadow-black/10" onClick={jumpToLatest}>
            Jump to latest
          </Button>
        )}
      </div>
      {busy && (
        <p role="status" className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span className="min-w-0 truncate">{statusLog.at(-1)?.label ?? "Working"}</span>
        </p>
      )}
      <div className="border-t border-border p-3">
        {runError && (
          <p id={errorId} role="alert" className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {runError}
          </p>
        )}
        {providerControls}
        {image && (
          <div className="mb-2 flex items-start gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="Image ready to attach" className="size-16 rounded-md object-cover" />
            <Button type="button" variant="ghost" size="icon" className={coarseTarget} aria-label="Remove attachment" onClick={() => onImageChange(undefined)}><X className="size-3.5" /></Button>
          </div>
        )}
        <div className="rounded-xl border border-border bg-muted/40 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <textarea
            rows={2}
            value={input}
            disabled={busy}
            maxLength={40000}
            aria-label="Project prompt"
            aria-invalid={runError ? true : undefined}
            aria-describedby={runError ? errorId : undefined}
            placeholder="Describe what to build or change…"
            onChange={(event) => {
              onInputChange(event.target.value);
              if (runError) onDismissError();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(false); }
            }}
            className="w-full resize-y bg-transparent p-3 text-base text-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
          />
          <div className="flex items-center justify-between px-2 pb-2" role="group" aria-label="Prompt actions">
            <input ref={file} type="file" accept={Object.keys(ATTACHMENT_TYPES).join(",")} className="hidden" aria-label="Choose an image to attach" onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = "";
            }} />
            <Button type="button" variant="ghost" size="icon" className={coarseTarget} aria-label="Attach image" disabled={busy || uploading} onClick={() => file.current?.click()}>
              {uploading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Paperclip className="size-4" />}
            </Button>
            {busy
              ? <Button type="button" variant="outline" size="icon" className={coarseTarget} aria-label="Stop run" onClick={onStop}><Square className="size-3.5" /></Button>
              : <Button type="button" size="icon" className={coarseTarget} aria-label={canRun ? "Send prompt" : "Check what's needed to send"} disabled={!input.trim() || uploading} onClick={() => void submit(false)}><ArrowUp className="size-4" /></Button>}
          </div>
        </div>
      </div>
    </aside>
  );
}
