"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AI_PROVIDERS, type AiProviderId, type AiProviderInfo, type AiProviderScope, type AiSelection, type AiSettings } from "@/lib/ai-providers";

const field = "h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring";
const sourceLabel = { personal: "Personal account", organization: "Organization account" } as const;
const providerIds = Object.keys(AI_PROVIDERS) as AiProviderId[];
const selectionKey = ({ scope, provider }: AiSelection) => `${scope}:${provider}`;

export function AiProviderControls(props: {
  settings: AiSettings | null; selection: AiSelection | null;
  loading: boolean; error?: string; disabled?: boolean; className?: string;
  open?: boolean; onOpenChange?: (open: boolean) => void;
  onSelect: (selection: AiSelection) => void; onRefresh: () => Promise<void>;
}) {
  const { settings, selection, loading, error, disabled, className, open, onOpenChange, onSelect, onRefresh } = props;
  const [notice, setNotice] = useState("");
  const choices: AiSelection[] = settings?.allowPersonal ? settings.personal.map((info) => ({ scope: "personal", ...info })) : [];
  if (settings?.organization) choices.push({ scope: "organization", ...settings.organization });
  const unconnected = providerIds.filter((provider) => !settings?.personal.some((info) => info.provider === provider));
  return (
    <div className={className ?? "mb-3 space-y-1.5 text-sm"}>
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="min-w-0 break-words text-xs text-muted-foreground">
          {selection ? <><strong className="font-medium text-foreground">{AI_PROVIDERS[selection.provider].name} · {selection.model}</strong><br />{sourceLabel[selection.scope]} pays</>
            : loading ? "Loading AI connections…" : error ? "AI connections unavailable" : "Connect or select a model to send your prompt."}
        </p>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger render={<Button type="button" size="sm" variant="outline" disabled={disabled} className="min-h-11 shrink-0 sm:min-h-8" />}>
            AI providers
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogTitle>AI providers</DialogTitle>
            <DialogDescription>Your chosen provider receives project files and prompts. Provider charges apply to the account shown in chat. Keys stay in this dialog and are not shown after saving.</DialogDescription>
            {notice && <p role="status" className="text-sm break-words text-foreground">{notice}</p>}
            {!settings ? (
              <div className="space-y-3">
                {loading ? <p role="status" className="text-muted-foreground">Loading AI connections…</p>
                  : <p role="alert" className="text-destructive">{error ?? "Could not load AI connections."}</p>}
                <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={loading} onClick={() => void onRefresh().catch(() => {})}>Retry loading connections</Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {choices.length > 0 ? (
                    <label className="block space-y-1 text-sm font-medium">
                      Use in this project
                      <select className={field} value={selection ? selectionKey(selection) : ""} disabled={disabled || loading} onChange={(event) => {
                        const next = choices.find((choice) => selectionKey(choice) === event.target.value);
                        if (next) onSelect(next);
                      }}>
                        <option value="" disabled>Choose a connection</option>
                        {choices.map((choice) => (
                          <option key={selectionKey(choice)} value={selectionKey(choice)}>
                            {AI_PROVIDERS[choice.provider].name} · {choice.model} · {sourceLabel[choice.scope]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : settings.allowPersonal && (
                    <p className="text-sm text-muted-foreground">Add a personal connection to start building.</p>
                  )}
                  {!settings.allowPersonal && !settings.organization && (
                    <p className="text-sm text-muted-foreground">{settings.role === "OWNER"
                      ? "Enable personal keys below or configure an organization connection before generating."
                      : "Ask an organization owner to enable personal keys or configure an organization connection."}</p>
                  )}
                  {selection && <p role="status" className="break-words text-xs text-muted-foreground">Selected: {selection.model} · {sourceLabel[selection.scope]}</p>}
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                  <h3 className="text-sm font-medium">Personal connections</h3>
                  {!settings.allowPersonal && <p className="text-xs text-muted-foreground">Personal connections are saved to your account but can’t be used in this organization.</p>}
                  {settings.personal.map((info) => (
                    <ProviderForm key={`${settings.orgId}:personal:${info.provider}:${info.model}`} orgId={settings.orgId}
                      scope="personal" current={info} providers={[info.provider]} disabled={disabled} onRefresh={onRefresh} onNotice={setNotice} />
                  ))}
                  {unconnected.length > 0 && (
                    <ProviderForm key={`${settings.orgId}:personal:add`} orgId={settings.orgId} scope="personal"
                      current={null} providers={unconnected} disabled={disabled} onRefresh={onRefresh} onNotice={setNotice} />
                  )}
                  {settings.role !== "MEMBER" && (
                    <ProviderForm key={`${settings.orgId}:organization:${settings.organization?.provider}:${settings.organization?.model}`} orgId={settings.orgId}
                      scope="organization" current={settings.organization} providers={providerIds} disabled={disabled} onRefresh={onRefresh} onNotice={setNotice} />
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

function ProviderForm({ orgId, scope, current, providers, disabled, onRefresh, onNotice }: {
  orgId: string; scope: AiProviderScope; current: AiProviderInfo | null; providers: AiProviderId[];
  disabled?: boolean; onRefresh: () => Promise<void>; onNotice: (message: string) => void;
}) {
  const [provider, setProvider] = useState<AiProviderId>(current?.provider ?? providers[0]);
  const [model, setModel] = useState(current?.model ?? AI_PROVIDERS[provider].suggestedModel);
  const [apiKey, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const confirmMounted = useRef(false);
  useEffect(() => {
    if (!confirmMounted.current) {
      confirmMounted.current = true;
      return;
    }
    if (confirmDisconnect) confirmRef.current?.focus();
    else disconnectRef.current?.focus();
  }, [confirmDisconnect]);
  const suggestedModel = AI_PROVIDERS[provider].suggestedModel;
  const title = scope === "organization" ? sourceLabel.organization
    : current ? AI_PROVIDERS[current.provider].name : "Add personal provider";

  function beginEdit() {
    const next = current?.provider ?? providers[0];
    setProvider(next);
    setModel(current?.model ?? AI_PROVIDERS[next].suggestedModel);
    setKey("");
    setError("");
    setConfirmDisconnect(false);
    setEditing(true);
  }

  async function submit(action: "connect" | "disconnect") {
    setPending(true);
    setError("");
    onNotice("");
    try {
      await saveSettings(orgId, action === "connect" ? { action, scope, config: { provider, model, apiKey } }
        : { action, scope, ...(scope === "personal" && current ? { provider: current.provider } : {}) });
      setKey("");
      setEditing(false);
      setConfirmDisconnect(false);
      await onRefresh();
      onNotice(action === "connect"
        ? "Connection saved. The key is stored for this account and is not shown."
        : "Connection removed from this account. The key was not shown.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the connection.");
    } finally { setPending(false); }
  }
  return (
    <fieldset disabled={disabled || pending} className="space-y-2 border-b border-border pb-3">
      {(current || scope === "organization" || editing) && <legend className="mb-1 text-sm font-medium">{title}</legend>}
      {current && <p className="text-sm break-all text-muted-foreground">{scope === "organization" && `${AI_PROVIDERS[current.provider].name} · `}{current.model} · Key saved</p>}
      {editing ? (
        <>
          <label className="block space-y-1 text-sm">Provider
            <select className={field} value={provider} onChange={(event) => {
              const next = event.target.value as AiProviderId;
              setProvider(next); setModel(AI_PROVIDERS[next].suggestedModel); setKey("");
            }}>
              {providers.map((id) => <option key={id} value={id}>{AI_PROVIDERS[id].name}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">Model ID
            <input className={field} value={model} onChange={(event) => setModel(event.target.value)} list={`model-${scope}-${current?.provider ?? "new"}`} maxLength={200} />
            <datalist id={`model-${scope}-${current?.provider ?? "new"}`}><option value={suggestedModel} /></datalist>
          </label>
          <label className="block space-y-1 text-sm">API key
            <input className={field} value={apiKey} onChange={(event) => setKey(event.target.value)} type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={1024} />
          </label>
          <p className="text-sm text-muted-foreground">The test sends a short synthetic prompt and may incur a provider charge. The key is not shown after it is saved.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" size="sm" className="min-h-11 sm:min-h-8" disabled={pending || !model.trim() || !apiKey.trim()} onClick={() => void submit("connect")}>
              {pending ? "Testing connection…" : "Test and save"}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => { setEditing(false); setKey(""); setError(""); }}>Cancel</Button>
          </div>
        </>
      ) : confirmDisconnect && current ? (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-3" role="group" aria-labelledby={`disconnect-${scope}-${current.provider}`}>
          <p ref={confirmRef} tabIndex={-1} id={`disconnect-${scope}-${current.provider}`} className="text-sm text-foreground outline-none">
            Disconnect {scope === "organization" ? "the organization connection" : AI_PROVIDERS[current.provider].name}? Drevo removes the saved key from this account. The key is not shown, and this does not revoke it at the provider.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="destructive" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => void submit("disconnect")}>
              {pending ? "Disconnecting…" : "Disconnect"}
            </Button>
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => { setConfirmDisconnect(false); setError(""); }}>Keep connection</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={pending} onClick={beginEdit}>{current ? "Replace connection" : scope === "personal" ? title : "Connect"}</Button>
          {current && <Button ref={disconnectRef} type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => { setError(""); setConfirmDisconnect(true); }}>Disconnect</Button>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
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
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-5" checked={allowed} disabled={pending} onChange={(event) => void change(event.target.checked)} />
        Allow personal keys in this organization
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
