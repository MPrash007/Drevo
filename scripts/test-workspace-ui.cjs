/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, dependencies = {}) {
  const text = ts.transpileModule(readFileSync(resolve(__dirname, "..", file), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const context = {
    exports: {},
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith(".") || name.startsWith("@/")) throw new Error(`Missing fixture for ${name}`);
      return require(name);
    },
  };
  vm.runInNewContext(text, context, { filename: file });
  return context.exports;
}

const viewport = load("lib/workspace-viewport.ts");
const workspace = load("components/WorkspaceClient.tsx", {
  react: require("react"),
  "react/jsx-runtime": require("react/jsx-runtime"),
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  sonner: { toast: { error() {}, success() {}, info() {} } },
  "@/actions/versions": { async getVersions() { return []; }, async restoreVersion() { throw new Error("unused"); } },
  "@/lib/ai-providers": {
    defaultAiSelection: () => null,
    async fetchAiSettings() { return null; },
    isAiSelectionAvailable: () => false,
  },
  "@/lib/workspace-viewport": viewport,
  "@/components/ui/button": { Button: () => null },
  "./AiProviderControls": { AiProviderControls: () => null },
  "./ChatPanel": { ChatPanel: () => null },
  "./CodePanel": { CodePanel: () => null },
  "./MobileBlocker": { MobileBlocker: () => null },
});
const chat = load("components/ChatPanel.tsx", {
  react: require("react"),
  "react/jsx-runtime": require("react/jsx-runtime"),
  "lucide-react": new Proxy({}, { get: () => () => null }),
  sonner: { toast: { error() {}, success() {}, info() {} } },
  "react-markdown": () => null,
  "@/components/ui/button": { Button: () => null },
  "./reusables": { BrandTitle: ({ children }) => children },
  "@/lib/ai-launch-intent": { consumeAiLaunch: () => false },
  "@/lib/attachments": { ATTACHMENT_TYPES: {}, MAX_ATTACHMENT_BYTES: 1 },
  "@/lib/workspace-viewport": viewport,
});

const workspaceSource = readFileSync(resolve(__dirname, "../components/WorkspaceClient.tsx"), "utf8");
const chatSource = readFileSync(resolve(__dirname, "../components/ChatPanel.tsx"), "utf8");
const blockerSource = readFileSync(resolve(__dirname, "../components/MobileBlocker.tsx"), "utf8");

test("a blocked viewport cannot consume a launch or start a run", () => {
  let consumed = false;
  assert.equal(workspace.gateWorkspaceRun({
    fits: false,
    alreadyRunning: false,
    canRun: true,
    hasSelection: true,
    consumeLaunch: () => { consumed = true; return true; },
  }), "viewport");
  assert.equal(consumed, false);
  assert.equal(chat.launchMayStart({
    fits: false, canRun: true, busy: false, uploading: false, draft: "Build a timer", prompt: "Build a timer",
  }), false);
});

test("a matching launch is consumed only after the viewport check", () => {
  let consumed = false;
  assert.equal(workspace.gateWorkspaceRun({
    fits: true,
    alreadyRunning: false,
    canRun: true,
    hasSelection: true,
    consumeLaunch: () => { consumed = true; return true; },
  }), "start");
  assert.equal(consumed, true);
  assert.equal(workspace.gateWorkspaceRun({
    fits: true,
    alreadyRunning: false,
    canRun: true,
    hasSelection: true,
    consumeLaunch: () => false,
  }), "skip");
  assert.equal(chat.launchMayStart({
    fits: true, canRun: true, busy: false, uploading: false, draft: "Build a timer", prompt: "Build a timer",
  }), true);
  assert.equal(chat.launchDraft("Edited prompt", "Build a timer"), "Edited prompt");
  assert.equal(chat.launchMayStart({
    fits: true, canRun: true, busy: false, uploading: false, draft: "Edited prompt", prompt: "Build a timer",
  }), false);
});

test("chat width leaves preview room at the 768px workspace minimum", () => {
  const bounds = workspace.chatWidthBounds(768);
  assert.equal(bounds.min, 240);
  assert.ok(bounds.max <= 768 - workspace.PREVIEW_MIN_WIDTH - workspace.SPLITTER_LAYOUT_WIDTH);
  assert.equal(workspace.clampChatWidth(560, 768), bounds.max);
  assert.ok(768 - bounds.max - workspace.SPLITTER_LAYOUT_WIDTH >= workspace.PREVIEW_MIN_WIDTH);
  assert.equal(workspace.clampChatWidth(100, 1280), 240);
  assert.equal(workspace.clampChatWidth(900, 1280), 560);
});

test("the editor is not mounted behind a CSS hide, and launch consumption stays behind the viewport gate", () => {
  assert.equal(viewport.WORKSPACE_VIEWPORT_QUERY, "(min-width: 768px) and (min-height: 500px)");
  assert.doesNotMatch(workspaceSource, /md:hidden|hidden md:flex|className="hidden h-\[calc\(100vh/);
  assert.match(workspaceSource, /viewport === "pending"/);
  assert.match(workspaceSource, /viewport === "blocked"/);
  assert.match(workspaceSource, /workspaceFitsViewport\(\)/);
  assert.match(workspaceSource, /100dvh-4rem/);
  assert.doesNotMatch(workspaceSource, /100vh-3\.5rem/);
  assert.match(blockerSource, /100dvh-4rem/);
  assert.match(blockerSource, /Stop run/);
  assert.doesNotMatch(blockerSource, /<textarea/);
  assert.match(chatSource, /launchMayStart/);
  assert.match(chatSource, /role="log"/);
  assert.match(chatSource, /motion-reduce:animate-none/);
  assert.match(chatSource, /onSendFinished\(ok\)/);
  const consumeAt = chatSource.indexOf("consumeAiLaunch(sessionStorage");
  const gateAt = workspaceSource.indexOf("if (!input.fits) return \"viewport\"");
  assert.ok(consumeAt > chatSource.indexOf("function consumeFor"));
  assert.ok(gateAt > workspaceSource.indexOf("export function gateWorkspaceRun"));
});

test("composer drafts are isolated by account, workspace and homepage launch", () => {
  const draft = workspace.composerStoragePrefix;
  assert.notEqual(draft("user-a", "org", "workspace"), draft("user-b", "org", "workspace"));
  assert.notEqual(draft("user", "org", "workspace-a"), draft("user", "org", "workspace-b"));
  assert.notEqual(draft("user", "org", null, "launch-a"), draft("user", "org", null, "launch-b"));
  assert.notEqual(draft("user", "org", null, "launch-a"), draft("user", "org", null));
});

function chromeBin() {
  const candidates = [
    process.env.CHROME_BIN ?? process.env.CHROME_PATH,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);
  for (const bin of candidates) {
    if (spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0) return bin;
  }
  return null;
}

test("Chromium matchMedia agrees with the workspace viewport query", (t) => {
  const bin = chromeBin();
  if (!bin) return t.skip("Chrome or Chromium is not installed");
  const dir = mkdtempSync(join(tmpdir(), "drevo-workspace-ui-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const html = join(dir, "viewport.html");
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>viewport fixture</title><body><pre id="out"></pre><script>
    const query = ${JSON.stringify(viewport.WORKSPACE_VIEWPORT_QUERY)};
    document.getElementById("out").textContent = JSON.stringify({
      fit: matchMedia(query).matches,
      width: innerWidth,
      height: innerHeight,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches
    });
  </script></body>`);
  const sizes = [
    { name: "phone", width: 390, height: 844, fit: false },
    { name: "phone-landscape", width: 844, height: 390, fit: false },
    { name: "tablet", width: 768, height: 1024, fit: true },
    { name: "short-tablet", width: 1024, height: 499, fit: false },
    { name: "desktop", width: 1280, height: 800, fit: true },
  ];
  for (const size of sizes) {
    const result = spawnSync(bin, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--user-data-dir=${join(dir, "profile")}`,
      `--window-size=${size.width},${size.height}`,
      "--virtual-time-budget=1000",
      "--dump-dom",
      `file://${html}`,
    ], { encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const match = result.stdout.match(/<pre id="out">([\s\S]*?)<\/pre>/);
    assert.ok(match, `No fixture result for ${size.name}: ${result.stdout.slice(0, 400)}`);
    const data = JSON.parse(match[1]);
    assert.equal(data.fit, size.fit, `${size.name} reported ${data.width}x${data.height}`);
  }
});
