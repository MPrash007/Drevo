"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AI_PROVIDERS, type AiProviderId, type AiProviderInfo, type AiProviderScope, type AiSelection, type AiSettings } from "@/lib/ai-providers";

const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-ring";
const sourceLabel = { personal: "Personal account", organization: "Organization account" } as const;

export function AiProviderControls(props: {
  settings: AiSettings | null; selection: AiSelection | null;
  loading: boolean; error?: string; disabled?: boolean; className?: string;
  open?: boolean; onOpenChange?: (open: boolean) => void;
  onSelect: (selection: AiSelection) => void; onRefresh: () => Promise<void>;
}) {
  const { settings, selection, loading, error, disabled, className, open, onOpenChange, onSelect, onRefresh } = props;
  return (
    <div className={className ?? "mb-3 space-y-1.5 text-sm"}>
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="min-w-0 break-words text-xs text-muted-foreground">
          {selection ? <><strong className="font-medium text-foreground">{AI_PROVIDERS[selection.provider].name} · {selection.model}</strong><br />{sourceLabel[selection.scope]} pays</>
            : loading ? "Loading AI connections…" : error ? "AI connections unavailable" : "Connect or select a model to send your prompt."}
        </p>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger render={<Button type="button" size="sm" variant="outline" disabled={disabled} />}>
            AI providers
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogTitle>AI providers</DialogTitle>
            <DialogDescription>Your chosen provider receives project files and prompts. Provider charges apply to the account shown in chat.</DialogDescription>
            {!settings ? (
              <div className="space-y-3">
                {loading ? <p role="status" className="text-muted-foreground">Loading AI connections…</p>
                  : <p role="alert" className="text-destructive">{error ?? "Could not load AI connections."}</p>}
                <Button variant="outline" disabled={loading} onClick={() => void onRefresh().catch(() => {})}>Retry loading connections</Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Use in this project</p>
                  {settings.allowPersonal && settings.personal && (
                    <Button size="sm" variant="outline" disabled={disabled} onClick={() => onSelect({ scope: "personal", ...settings.personal! })}>
                      Use personal connection
                    </Button>
                  )}
                  {settings.organization && (
                    <Button className="ml-1" size="sm" variant="outline" disabled={disabled} onClick={() => onSelect({ scope: "organization", ...settings.organization! })}>
                      Use organization connection
                    </Button>
                  )}
                  {!settings.allowPersonal && !settings.organization && (
                    <p className="text-sm text-muted-foreground">{settings.role === "OWNER"
                      ? "Enable personal keys below or configure an organization connection before generating."
                      : "Ask an organization owner to enable personal keys or configure an organization connection."}</p>
                  )}
                  {selection && <p role="status" className="break-words text-xs text-muted-foreground">Selected: {selection.model} · {sourceLabel[selection.scope]}</p>}
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                  <ProviderForm key={`personal:${settings.personal?.provider}:${settings.personal?.model}`} orgId={settings.orgId} scope="personal" current={settings.personal} onRefresh={onRefresh} />
                  {settings.role !== "MEMBER" && (
                    <ProviderForm key={`organization:${settings.organization?.provider}:${settings.organization?.model}`} orgId={settings.orgId} scope="organization" current={settings.organization} onRefresh={onRefresh} />
                  )}
                  {settings.role === "OWNER" && <PolicyControl orgId={settings.orgId} allowed={settings.allowPersonal} onRefresh={onRefresh} />}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

async function saveSettings(orgId: string, body: object) {
  const response = await fetch("/api/ai/providers", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, ...body }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message ?? "Could not update provider settings.");
  }
}

function ProviderForm({ orgId, scope, current, onRefresh }: {
  orgId: string; scope: AiProviderScope; current: AiProviderInfo | null; onRefresh: () => Promise<void>;
}) {
  const [provider, setProvider] = useState<AiProviderId>(current?.provider ?? "openai");
  const [model, setModel] = useState(current?.model ?? AI_PROVIDERS.openai.suggestedModel);
  const [apiKey, setKey] = useState("");
  const [editing, setEditing] = useState(!current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const suggestedModel = AI_PROVIDERS[provider].suggestedModel;

  async function submit(action: "connect" | "disconnect") {
    setPending(true);
    setError("");
    try {
      await saveSettings(orgId, action === "connect" ? { action, scope, config: { provider, model, apiKey } } : { action, scope });
      setKey("");
      setEditing(false);
      await onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the connection.");
    } finally { setPending(false); }
  }
  return (
    <fieldset className="space-y-2 border-b border-border pb-3">
      <legend className="mb-1 text-sm font-medium">{sourceLabel[scope]}</legend>
      {current && <p className="break-words text-xs text-muted-foreground">{AI_PROVIDERS[current.provider].name} · {current.model} · Key saved</p>}
      {editing ? (
        <>
          <label className="block space-y-1 text-xs">Provider
            <select className={field} value={provider} onChange={(event) => {
              const next = event.target.value as AiProviderId;
              setProvider(next); setModel(AI_PROVIDERS[next].suggestedModel); setKey("");
            }}>
              {Object.entries(AI_PROVIDERS).map(([id, info]) => <option key={id} value={id}>{info.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-xs">Model ID
            <input className={field} value={model} onChange={(event) => setModel(event.target.value)} list={`model-${scope}`} maxLength={200} />
            <datalist id={`model-${scope}`}><option value={suggestedModel} /></datalist>
          </label>
          <label className="block space-y-1 text-xs">API key
            <input className={field} value={apiKey} onChange={(event) => setKey(event.target.value)} type="password" autoComplete="off" maxLength={1024} />
          </label>
          <p className="text-xs text-muted-foreground">The test sends a short synthetic prompt and may incur a provider charge.</p>
          <Button type="button" size="sm" disabled={pending || !model.trim() || !apiKey.trim()} onClick={() => void submit("connect")}>
            {pending ? "Testing connection…" : "Test and save"}
          </Button>
          {current && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setEditing(false); setKey(""); }}>Cancel</Button>}
        </>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setEditing(true)}>{current ? "Replace connection" : "Connect"}</Button>
          {current && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void submit("disconnect")}>Disconnect</Button>}
        </>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

function PolicyControl({ orgId, allowed, onRefresh }: { orgId: string; allowed: boolean; onRefresh: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function change(next: boolean) {
    setPending(true); setError("");
    try { await saveSettings(orgId, { action: "policy", allowPersonal: next }); await onRefresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not update the policy."); }
    finally { setPending(false); }
  }
  return (
    <div className="space-y-1">
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" checked={allowed} disabled={pending} onChange={(event) => void change(event.target.checked)} />
        Allow personal keys in this organization
      </label>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
