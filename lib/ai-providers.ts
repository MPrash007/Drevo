export const AI_PROVIDERS = {
  openai: { name: "OpenAI", baseURL: "https://api.openai.com/v1", suggestedModel: "gpt-4.1" },
  xai: { name: "xAI", baseURL: "https://api.x.ai/v1", suggestedModel: "grok-4-1-fast-non-reasoning" },
  groq: { name: "Groq", baseURL: "https://api.groq.com/openai/v1", suggestedModel: "openai/gpt-oss-120b" },
  openrouter: { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", suggestedModel: "anthropic/claude-sonnet-4.5" },
} as const;

export type AiProviderId = keyof typeof AI_PROVIDERS;
export type AiProviderScope = "personal" | "organization";
export type AiProviderInfo = { provider: AiProviderId; model: string };
export type AiSelection = AiProviderInfo & { scope: AiProviderScope };
export type AiSettings = {
  orgId: string;
  personal: AiProviderInfo | null;
  organization: AiProviderInfo | null;
  allowPersonal: boolean;
  role: "OWNER" | "ADMIN" | "MEMBER";
  selection: AiSelection | null;
};

export function defaultAiSelection(settings: AiSettings | null): AiSelection | null {
  if (!settings) return null;
  const scope = settings.allowPersonal ? "personal" : "organization";
  const connection = settings[scope];
  return connection ? { scope, ...connection } : null;
}

export async function fetchAiSettings(ids: { orgId?: string; workspaceId?: string } = {}, signal?: AbortSignal): Promise<AiSettings> {
  const params = new URLSearchParams();
  if (ids.orgId) params.set("orgId", ids.orgId);
  if (ids.workspaceId) params.set("workspaceId", ids.workspaceId);
  const response = await fetch(`/api/ai/providers?${params}`, { cache: "no-store", signal });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.message === "string" ? data.message : "Could not load AI connections. Try again.");
  }
  return response.json();
}
