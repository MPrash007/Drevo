"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, useClerk, SignInButton } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { ArrowRight, Zap, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HoleBackground } from "@/components/animate-ui/components/backgrounds/hole";
import { FEATURES, PLACEHOLDERS, STEPS, SUGGESTIONS } from "@/lib/data";
import {
  BrandTitle,
  GrayTitle,
  SectionHeading,
  SectionLabel,
} from "@/components/reusables";
import { LogoMark } from "@/components/LogoMark";
import { AiProviderControls } from "@/components/AiProviderControls";
import { defaultAiSelection, fetchAiSettings, isAiSelectionAvailable, type AiSelection, type AiSettings } from "@/lib/ai-providers";
import { rememberAiLaunch } from "@/lib/ai-launch-intent";
import { WORKSPACE_VIEWPORT_QUERY, workspaceFitsViewport } from "@/lib/workspace-viewport";

const DESKTOP_NOTE_ID = "desktop-workspace-note";
const CTA_PARTICLE: [number, number, number] = [196, 181, 253];

type LandingGenerateSource = "enter" | "button";
type LandingGenerateAction = "ignore" | "desktop" | "sign-in" | "providers" | "launch";

function landingGenerateAction(input: {
  prompt: string;
  signedIn: boolean;
  fitsViewport: boolean;
  hasSelection: boolean;
  source: LandingGenerateSource;
}): LandingGenerateAction {
  if (!input.fitsViewport) return "desktop";
  const draft = input.prompt.trim();
  if (!input.signedIn) return input.source === "enter" && !draft ? "ignore" : "sign-in";
  if (!draft) return "ignore";
  if (!input.hasSelection) return "providers";
  return "launch";
}

export default function LandingPage() {
  const { resolvedTheme } = useTheme();
  const { isSignedIn, userId, orgId } = useAuth();
  const { openSignIn } = useClerk();
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);

  const [prompt, setPrompt] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const viewer = isSignedIn ? `${userId}:${orgId ?? "personal"}` : null;
  const [connections, setConnections] = useState<{ viewer: string; settings: AiSettings | null; error?: string }>();
  const [choice, setChoice] = useState<{ orgId: string; selection: AiSelection }>();
  const [retrying, setRetrying] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [fits, setFits] = useState<boolean | null>(null);
  const current = connections?.viewer === viewer ? connections : undefined;
  const settings = current?.settings ?? null;
  const preferred = settings && choice?.orgId === settings.orgId ? choice.selection : defaultAiSelection(settings);
  const selected = isAiSelectionAvailable(preferred, settings) ? preferred : null;
  const example = PLACEHOLDERS[placeholderIndex] ?? PLACEHOLDERS[0];

  useEffect(() => {
    if (!viewer) return;
    const controller = new AbortController();
    void fetchAiSettings({}, controller.signal)
      .then((settings) => { if (!controller.signal.aborted) setConnections({ viewer, settings }); })
      .catch((error) => { if (!controller.signal.aborted) setConnections({ viewer, settings: null, error: error.message }); });
    return () => controller.abort();
  }, [viewer]);

  async function refreshConnections() {
    if (!viewer) return;
    setRetrying(true);
    try { setConnections({ viewer, settings: await fetchAiSettings() }); }
    catch (error) {
      setConnections({ viewer, settings: null, error: error instanceof Error ? error.message : "Could not load AI connections." });
      throw error;
    } finally { setRetrying(false); }
  }

  useEffect(() => {
    const media = window.matchMedia(WORKSPACE_VIEWPORT_QUERY);
    const sync = () => setFits(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (fits !== false || !focusNotice.current) return;
    focusNotice.current = false;
    noticeRef.current?.focus();
  }, [fits]);

  useEffect(() => {
    if (isFocused || prompt) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (media.matches) {
        setPlaceholderIndex(0);
        return;
      }
      timer = setInterval(() => setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length), 3000);
    };
    sync();
    media.addEventListener("change", sync);
    return () => {
      clearInterval(timer);
      media.removeEventListener("change", sync);
    };
  }, [isFocused, prompt]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!prompt) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [prompt]);

  function submitPrompt(source: LandingGenerateSource) {
    const action = landingGenerateAction({
      prompt,
      signedIn: Boolean(isSignedIn),
      fitsViewport: workspaceFitsViewport(),
      hasSelection: Boolean(selected && settings),
      source,
    });
    if (action === "desktop") {
      focusNotice.current = true;
      setFits(false);
      noticeRef.current?.focus();
      return;
    }
    if (action === "sign-in") {
      openSignIn({});
      return;
    }
    if (action !== "launch") {
      if (action === "providers") setProvidersOpen(true);
      return;
    }
    if (!selected || !settings) {
      setProvidersOpen(true);
      return;
    }
    const draft = prompt.trim();
    const params = new URLSearchParams({ prompt: draft, org: settings.orgId, ...selected });
    try {
      const token = crypto.randomUUID();
      rememberAiLaunch(sessionStorage, { token, prompt: draft, orgId: settings.orgId, selection: selected });
      params.set("start", token);
    } catch { /* Without browser storage, open the workspace with an unsent draft. */ }
    router.push(`/workspace?${params}`);
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitPrompt("enter");
    }
  };

  const handleSuggestion = (s: string) => {
    setPrompt(s);
    textareaRef.current?.focus();
  };

  const holeMask = {
    maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)",
    WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)",
  } as const;
  const stroke = resolvedTheme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.05)";

  return (
    <div className="min-h-screen bg-background selection:bg-foreground/20">
      <section className="relative flex flex-col items-center overflow-hidden px-4 pb-24 pt-40 text-center">
        <HoleBackground
          strokeColor={stroke}
          className="absolute inset-0 h-full w-full"
          style={holeMask}
        />

        <h1 className="z-10 mx-auto max-w-3xl text-balance font-serif text-5xl leading-tight tracking-tight sm:text-6xl lg:text-7xl">
          <GrayTitle>Dream it.</GrayTitle>
          <br />
          <BrandTitle>Develop it.</BrandTitle>
        </h1>

        <p className="z-10 mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground">
          Describe what you want to build. Drevo writes the code, picks the
          packages, and renders a live preview all inside your browser.
        </p>

        <div className="relative mx-auto mt-12 w-full min-w-0 max-w-2xl">
          <div
            className={cn(
              "rounded-2xl border bg-card duration-200",
              isFocused
                ? "border-ring ring-1 ring-ring/20"
                : "border-border"
            )}
          >
            <label htmlFor="home-prompt" className="sr-only">Describe the app to generate</label>
            <div className="grid">
              {!prompt && (
                <p aria-hidden="true" className="pointer-events-none col-start-1 row-start-1 px-5 pb-4 pt-5 text-left text-base text-muted-foreground">
                  {example}
                </p>
              )}
              <textarea
                id="home-prompt"
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                rows={1}
                name="prompt"
                aria-describedby={fits === false ? DESKTOP_NOTE_ID : undefined}
                className={cn(
                  "col-start-1 row-start-1 min-h-20 w-full min-w-0 resize-none overflow-x-hidden bg-transparent px-5 pb-4 pt-5 text-left text-base text-foreground focus:outline-none sm:min-h-14",
                  !prompt && "text-transparent caret-foreground",
                )}
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-left sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              {isSignedIn ? (
                <AiProviderControls
                  className="min-w-0 w-full sm:flex-1"
                  settings={settings} selection={selected} loading={!current || retrying} error={current?.error}
                  open={providersOpen} onOpenChange={setProvidersOpen}
                  onSelect={(selection) => { if (settings) setChoice({ orgId: settings.orgId, selection }); }}
                  onRefresh={refreshConnections}
                />
              ) : (
                <SignInButton mode="modal">
                  <Button type="button" variant="outline" className="h-11 sm:h-8" size="sm">AI providers</Button>
                </SignInButton>
              )}

              <Button
                type="button"
                onClick={() => submitPrompt("button")}
                disabled={Boolean(isSignedIn && !prompt.trim())}
                className="h-11 w-full shrink-0 rounded-full px-5 font-semibold sm:h-8 sm:w-auto"
                variant={!isSignedIn || prompt.trim() ? "default" : "secondary"}
                aria-describedby={fits === false ? DESKTOP_NOTE_ID : undefined}
              >
                Generate
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {fits === false && (
            <p
              ref={noticeRef}
              id={DESKTOP_NOTE_ID}
              tabIndex={-1}
              role="status"
              className="mt-4 text-left text-sm leading-relaxed text-foreground focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              The workspace needs a window at least 768px wide and 500px tall. Generate does not start a build from this screen.
            </p>
          )}

          <div className="mt-4 flex min-w-0 flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSuggestion(s)}
                className="max-w-full min-h-11 whitespace-normal rounded-full border border-border bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-10 text-xs text-muted-foreground">
          Bring your own AI provider key
        </p>
      </section>

      <section className="px-4 pb-16 sm:pb-32">
        <h2 className="sr-only">Workspace preview</h2>
        <div aria-hidden="true" className="dark mx-auto max-w-5xl overflow-hidden rounded-2xl border border-white/8 bg-[#0f0f0f] text-white shadow-2xl shadow-black/20">
          <div className="flex items-center gap-2 border-b border-white/6 px-3 py-3 sm:px-4">
            <div className="flex shrink-0 gap-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-3 w-3 rounded-full bg-white/10" />
              ))}
            </div>

            <div className="mx-auto flex h-6 min-w-0 max-w-64 flex-1 items-center justify-center rounded-md bg-white/5 px-3">
              <span className="truncate text-xs text-white/70">drevo.app/workspace</span>
            </div>
          </div>

          <div className="flex flex-col md:h-[26rem] md:flex-row">
            <div className="flex flex-col border-b border-white/6 bg-[#0d0d0d] md:w-80 md:shrink-0 md:border-r md:border-b-0">
              <div className="border-b border-white/6 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-white/70">
                  Chat
                </p>
              </div>

              <div className="space-y-4 px-4 py-4 md:flex-1 md:overflow-hidden">
                <div className="flex justify-end">
                  <div className="max-w-full rounded-2xl rounded-br-sm bg-white/10 px-3.5 py-2.5 sm:max-w-55">
                    <p className="text-xs text-white/80">
                      Build a kanban board with 3 columns and drag-and-drop
                    </p>
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white">
                    <Zap className="h-3 w-3 fill-black text-black" />
                  </div>

                  <div className="min-w-0 rounded-2xl rounded-tl-sm bg-white/5 px-3.5 py-2.5">
                    <p className="text-xs text-white/70">
                      I&apos;ll build a Kanban board with Todo, In Progress, and
                      Done columns. I&apos;ll use{" "}
                      <code className="text-violet-300">@dnd-kit/core</code>{" "}
                      for smooth drag-and-drop…
                    </p>
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white">
                    <Zap className="h-3 w-3 fill-black text-black" />
                  </div>
                  <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-white/5 px-3.5 py-3">
                    {[0, 0.15, 0.3].map((delay) => (
                      <span
                        key={delay}
                        className="h-1.5 w-1.5 rounded-full bg-white/70 motion-safe:animate-bounce"
                        style={{ animationDelay: `${delay}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t border-white/6 px-3 py-3">
                <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-white/70">
                    Ask AI to modify…
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/70" />
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-1 border-b border-white/6 px-3 sm:px-4">
                <span className="border-b-2 border-violet-300 px-3 py-2.5 text-xs text-white">
                  Preview
                </span>
                <span className="px-3 py-2.5 text-xs text-white/70">
                  Code
                </span>
              </div>

              <div className="grid min-w-0 grid-cols-3 gap-2 bg-[#141414] p-3 sm:gap-3 sm:p-5 md:flex-1">
                {["Todo", "In Progress", "Done"].map((col, ci) => (
                  <div key={col} className="flex min-w-0 flex-col gap-2">
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <span className="truncate text-[10px] uppercase tracking-wider text-white/70 sm:text-xs">
                        {col}
                      </span>

                      <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-xs text-white/70">
                        {[3, 2, 1][ci]}
                      </span>
                    </div>

                    {Array.from({ length: [3, 2, 1][ci] }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-white/8 bg-[#1a1a1a] p-2.5"
                      >
                        <div
                          className="mb-1.5 h-2 rounded-full bg-white/15"
                          style={{ width: `${60 + i * 15}%` }}
                        />
                        <div className="h-1.5 w-3/4 rounded-full bg-white/8" />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 pb-32">
        <div className="mx-auto mb-14 max-w-5xl text-center">
          <SectionLabel>Everything you need</SectionLabel>
          <SectionHeading gray="From prompt" brand="to code you keep." />
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className="group bg-background p-7 hover:bg-card"
            >
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/40 group-hover:bg-muted">
                <Icon className="h-4 w-4 text-muted-foreground group-hover:text-violet-700 dark:group-hover:text-violet-300" />
              </div>
              <p className="mb-2 text-sm font-semibold">{label}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 pb-32">
        <div className="mx-auto mb-14 max-w-3xl text-center">
          <SectionLabel>How it works</SectionLabel>
          <SectionHeading gray="Four steps" brand="to a working app." />
        </div>

        <div className="mx-auto max-w-3xl">
          {STEPS.map((step, i) => (
            <div key={step.number} className="flex gap-6">
              <div className="flex flex-col items-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/40">
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {step.number}
                  </span>
                </div>

                {i < STEPS.length - 1 && (
                  <div className="mt-2 h-full w-px bg-border" />
                )}
              </div>

              <div className="min-w-0 pb-10 pt-1.5">
                <p className="mb-1.5 text-sm font-semibold sm:text-base">
                  {step.label}
                </p>

                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="px-4">
        <section className="relative mx-auto mb-16 max-w-5xl overflow-hidden rounded-2xl border border-border px-5 py-16 text-center sm:mb-32 sm:px-10 sm:py-24">
          <HoleBackground
            animated={false}
            strokeColor={stroke}
            numberOfLines={36}
            numberOfDiscs={36}
            particleRGBColor={CTA_PARTICLE}
            className="absolute inset-0 h-full w-full"
            style={{
              maskImage: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
              WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
            }}
          />

          <SectionHeading gray="Start building" brand="with your own key." />

          <p className="relative mb-8 text-sm leading-relaxed text-muted-foreground">
            Connect an AI provider and build with the model you choose. Provider charges apply to your connected account.
          </p>

          <SignInButton mode="modal">
            <Button
              size="lg"
              className="relative h-11 rounded-full px-8"
            >
              Get started
              <ChevronRight className="h-4 w-4" />
            </Button>
          </SignInButton>
        </section>
      </div>

      <footer className="relative z-10 border-t border-border px-6 py-12">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-8 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <Link href="/" className="flex items-center gap-2 select-none" aria-label="Drevo home">
              <LogoMark size="md" />
            </Link>
            <p className="text-xs text-muted-foreground">
              Dream it. Develop it.
            </p>
          </div>

          <div className="flex items-center gap-6 text-[13px] text-muted-foreground">
            <Link
              href="/projects"
              className="inline-flex min-h-11 items-center transition-colors hover:text-foreground sm:min-h-0"
            >
              Projects
            </Link>
            <Link
              href="/workspace"
              className="inline-flex min-h-11 items-center transition-colors hover:text-foreground sm:min-h-0"
            >
              Workspace
            </Link>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-5xl text-center text-xs text-muted-foreground sm:text-left">
          © 2026 Drevo. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
