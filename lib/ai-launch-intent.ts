import type { AiSelection } from "@/lib/ai-providers";

const key = "drevo:ai-launch";
type Launch = { token: string; prompt: string; orgId: string; selection: AiSelection };
type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function value({ token, prompt, orgId, selection: { scope, provider, model } }: Launch) {
  return JSON.stringify([token, prompt, orgId, scope, provider, model]);
}

export function rememberAiLaunch(storage: IntentStorage, launch: Launch) {
  storage.setItem(key, value(launch));
}

export function consumeAiLaunch(storage: IntentStorage, launch: Launch) {
  if (storage.getItem(key) !== value(launch)) return false;
  storage.removeItem(key);
  return true;
}
