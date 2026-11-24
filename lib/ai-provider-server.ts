import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, tool } from "ai";
import { z } from "zod";
import { AI_PROVIDERS, type AiProviderScope } from "@/lib/ai-providers";

export const ProviderSchema = z.object({
  provider: z.enum(["openai", "xai", "groq", "openrouter"]),
  model: z.string().trim().min(1).max(200).regex(/^[\w./:@+-]+$/),
});
export const ProviderInputSchema = ProviderSchema.extend({
  apiKey: z.string().trim().min(1).max(1024).regex(/^[!-~]+$/),
});
export const SelectionSchema = ProviderSchema.extend({ scope: z.enum(["personal", "organization"]) });
const StoredSchema = ProviderSchema.extend({ encryptedKey: z.string() });

function encryptionKey() {
  const key = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  if (!key || !/^[a-f\d]{64}$/i.test(key)) throw new Error("AI provider encryption is not configured.");
  return Buffer.from(key, "hex");
}

export function sealProvider(input: z.infer<typeof ProviderInputSchema>, owner: string) {
  const { apiKey, ...info } = input;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(JSON.stringify([owner, info.provider, info.model])));
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return { ...info, encryptedKey: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64") };
}

export function publicProvider(value: unknown) {
  const parsed = ProviderSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function selectProvider(args: {
  userId: string; orgId: string; personal: unknown; organization: unknown;
  allowPersonal: boolean; scope: AiProviderScope;
}) {
  const { scope } = args;
  if (scope === "personal" && !args.allowPersonal) {
    return { message: "This organization does not allow personal API keys. Ask an owner to configure AI Providers." } as const;
  }
  const config = StoredSchema.safeParse(scope === "personal" ? args.personal : args.organization);
  if (!config.success) {
    return { message: "No API key is connected for this source. Open AI Providers to connect one." } as const;
  }
  return { config: config.data, owner: scope === "personal" ? `user:${args.userId}` : `org:${args.orgId}` };
}

export function openModel(config: z.infer<typeof StoredSchema>, owner: string) {
  const payload = Buffer.from(config.encryptedKey, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(JSON.stringify([owner, config.provider, config.model])));
  decipher.setAuthTag(payload.subarray(12, 28));
  const apiKey = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
  const provider = AI_PROVIDERS[config.provider];
  return createOpenAICompatible({
    name: config.provider,
    baseURL: provider.baseURL,
    apiKey,
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
  }).chatModel(config.model);
}

export async function checkModel(config: z.infer<typeof StoredSchema>, owner: string, signal: AbortSignal) {
  const stream = streamText({
    model: openModel(config, owner),
    prompt: "Call check_connection with ready set to true.",
    tools: { check_connection: tool({ inputSchema: z.object({ ready: z.literal(true) }), execute: async () => "OK" }) },
    toolChoice: "required",
    maxRetries: 0,
    onError: () => {}, // SDK default logs provider errors, which can contain request data.
    abortSignal: signal,
    maxOutputTokens: 512,
  });
  let checked = false;
  for await (const part of stream.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "tool-result" && part.toolName === "check_connection") checked = true;
  }
  if (!checked) throw new Error("The model did not complete a tool call.");
}

export function providerError(error: unknown) {
  const name = (error as { name?: string } | null)?.name;
  if (name === "AI_ToolChoiceViolationError") return "The selected model did not complete a required tool call. Choose a model with streamed tool support.";
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (status === 401 || status === 403) return "The provider rejected the key or denied access to this model.";
  if (status === 404) return "The provider could not find this model. Check the exact model ID.";
  if (status === 429 || status === 402) return "Check the provider account’s rate limit, quota, or billing.";
  if (status === 400 || status === 422) return "The provider rejected the request. Check that this model supports streamed tool calls.";
  return "The model request failed. Check the provider status, API key, and model ID, then try again.";
}
