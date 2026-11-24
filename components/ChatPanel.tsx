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

interface Props {
  messages: Message[];
  isGenerating: boolean;
  isImproving: boolean;
  statusLog: StatusStep[];
  canRun: boolean;
  onBlockedSubmit: () => void;
  launch?: Parameters<typeof consumeAiLaunch>[1];
  providerControls: ReactNode;
  initialPrompt: string | null;
  onGenerate: (prompt: string, imageUrl?: string) => Promise<boolean>;
  onRegenerate: () => void;
  onEditMessage: (index: number, content: string) => void;
  onStop: () => void;
  orgId: string;
  appTitle: string | null;
  width: number;
}

export function ChatPanel({
  messages, isGenerating, isImproving, statusLog, canRun, onBlockedSubmit, launch, providerControls,
  initialPrompt, onGenerate, onRegenerate, onEditMessage, onStop, orgId, appTitle, width,
}: Props) {
  const [input, setInput] = useState(initialPrompt ?? "");
  const [image, setImage] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const busy = isGenerating || isImproving;

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages, statusLog]);

  async function submit() {
    if (busy || uploading || !input.trim()) return;
    if (!canRun) {
      onBlockedSubmit();
      return;
    }
    if (launch) {
      try { consumeAiLaunch(sessionStorage, launch); } catch { /* Manual send does not require browser storage. */ }
    }
    const prompt = input.trim();
    setInput("");
    setImage(undefined);
    if (!await onGenerate(prompt, image)) {
      setInput(prompt);
      setImage(image);
    }
  }

  const submitLaunch = useEffectEvent((intent: NonNullable<Props["launch"]>) => {
    if (!canRun || input !== intent.prompt || busy || uploading) return;
    try {
      if (consumeAiLaunch(sessionStorage, intent)) void submit();
    } catch { /* Keep the draft available for a manual send. */ }
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
      setImage(data.url);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not upload the image."); }
    finally { setUploading(false); }
  }

  return (
    <aside className="flex h-full shrink-0 flex-col bg-card" style={{ width }}>
      <div className="truncate border-b border-border px-3 py-3"><BrandTitle>{appTitle ?? "New project"}</BrandTitle></div>
      <div ref={scroll} className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Project conversation">
        {!messages.length && <p className="py-5 text-center text-sm text-muted-foreground">Describe the app you want to build.</p>}
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "space-y-2 rounded-lg bg-muted p-3" : "space-y-2 px-1"}>
            {editing === index ? (
              <>
                <textarea aria-label="Edit prompt" value={draft} onChange={(event) => setDraft(event.target.value)} className="w-full rounded border border-border bg-background p-2 text-sm" />
                <Button size="sm" disabled={busy || !canRun || !draft.trim()} onClick={() => { onEditMessage(index, draft.trim()); setEditing(null); }}>Resend</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              </>
            ) : (
              <>
                {message.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={message.imageUrl} alt="Prompt attachment" className="max-h-40 rounded-md object-contain" />
                )}
                {message.content && <div className="min-w-0 overflow-x-auto break-words text-sm [&_p]:mb-2"><ReactMarkdown>{message.content}</ReactMarkdown></div>}
                {message.content && !busy && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label="Copy message" onClick={() => {
                      void navigator.clipboard.writeText(message.content).then(() => toast.success("Copied.")).catch(() => toast.error("Copy failed."));
                    }}><Copy className="size-3.5" /></Button>
                    {message.role === "user" && <Button variant="ghost" size="icon" aria-label="Edit prompt" disabled={!canRun} onClick={() => { setEditing(index); setDraft(message.content); }}><Pencil className="size-3.5" /></Button>}
                    {message.role === "assistant" && index === messages.length - 1 && <Button variant="ghost" size="icon" aria-label="Regenerate response" disabled={!canRun} onClick={onRegenerate}><RotateCcw className="size-3.5" /></Button>}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{statusLog.at(-1)?.label ?? "Working…"}</p>}
      </div>
      <div className="border-t border-border p-3">
        {providerControls}
        {image && (
          <div className="mb-2 flex items-start gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="Image ready to attach" className="size-16 rounded-md object-cover" />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove attachment" onClick={() => setImage(undefined)}><X className="size-3.5" /></Button>
          </div>
        )}
        <div className="rounded-xl border border-border bg-muted/40 focus-within:border-ring">
          <textarea
            rows={2} value={input} disabled={busy} maxLength={40000} aria-label="Project prompt"
            placeholder="Describe what to build or change…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
            }}
            className="w-full resize-y bg-transparent p-3 text-sm focus-visible:outline-none"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <input ref={file} type="file" accept={Object.keys(ATTACHMENT_TYPES).join(",")} className="hidden" onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = "";
            }} />
            <Button variant="ghost" size="icon" aria-label="Attach image" disabled={busy || uploading} onClick={() => file.current?.click()}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            </Button>
            {busy
              ? <Button variant="outline" size="icon" aria-label="Stop run" onClick={onStop}><Square className="size-3.5" /></Button>
              : <Button size="icon" aria-label={canRun ? "Send prompt" : "Check what’s needed to send"} disabled={!input.trim() || uploading} onClick={() => void submit()}><ArrowUp className="size-4" /></Button>}
          </div>
        </div>
      </div>
    </aside>
  );
}
