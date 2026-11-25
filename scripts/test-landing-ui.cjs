// Landing and invitation UI regressions. No network, no .env, no provider calls.
// Run: node scripts/test-landing-ui.cjs
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, dependencies = {}, globals = {}, extra = "") {
  const source = readFileSync(resolve(__dirname, "..", file), "utf8") + extra;
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const context = {
    exports: {},
    Error, URLSearchParams, console: { error() {}, warn() {} },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    ...globals,
  };
  vm.runInNewContext(code, context, { filename: file });
  return context.exports;
}

function contrast(hex, background) {
  const lin = (channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (value) => {
    const n = parseInt(value.slice(1), 16);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const [hi, lo] = [lum(hex), lum(background)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test("generate action blocks phone launch and opens sign-in for signed-out Enter", () => {
  const page = load("app/page.tsx", {
    react: { useState: () => [null, () => {}], useEffect() {}, useRef: () => ({ current: null }) },
    "react/jsx-runtime": { jsx: () => null, jsxs: () => null },
    "next/link": { default: "Link" },
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "@clerk/nextjs": { useAuth: () => ({}), useClerk: () => ({ openSignIn() {} }), SignInButton: "SignInButton" },
    "next-themes": { useTheme: () => ({}) },
    "lucide-react": new Proxy({}, { get: () => "Icon" }),
    "@/lib/utils": { cn: () => "" },
    "@/components/ui/button": { Button: "Button" },
    "@/components/animate-ui/components/backgrounds/hole": { HoleBackground: "Hole" },
    "@/lib/data": { FEATURES: [], PLACEHOLDERS: ["A task manager with drag and drop…"], STEPS: [], SUGGESTIONS: [] },
    "@/components/reusables": { BrandTitle: "Brand", GrayTitle: "Gray", SectionHeading: "Heading", SectionLabel: "Label" },
    "@/components/LogoMark": { LogoMark: "Logo" },
    "@/components/AiProviderControls": { AiProviderControls: "Providers" },
    "@/lib/ai-providers": {
      defaultAiSelection: () => null,
      fetchAiSettings: async () => null,
      isAiSelectionAvailable: () => false,
    },
    "@/lib/ai-launch-intent": { rememberAiLaunch() { throw new Error("launch helper must not run while loading the action"); } },
    "@/lib/workspace-viewport": {
      WORKSPACE_VIEWPORT_QUERY: "(min-width: 768px) and (min-height: 500px)",
      workspaceFitsViewport: () => false,
    },
  }, {}, "\nexport { landingGenerateAction };");
  const cases = [
    [{ prompt: "Build a board", signedIn: true, fitsViewport: false, hasSelection: true, source: "button" }, "desktop"],
    [{ prompt: "Build a board", signedIn: true, fitsViewport: false, hasSelection: true, source: "enter" }, "desktop"],
    [{ prompt: "", signedIn: false, fitsViewport: false, hasSelection: false, source: "button" }, "desktop"],
    [{ prompt: "Build a board", signedIn: false, fitsViewport: true, hasSelection: false, source: "enter" }, "sign-in"],
    [{ prompt: "", signedIn: false, fitsViewport: true, hasSelection: false, source: "enter" }, "ignore"],
    [{ prompt: "", signedIn: false, fitsViewport: true, hasSelection: false, source: "button" }, "sign-in"],
    [{ prompt: "Build a board", signedIn: true, fitsViewport: true, hasSelection: false, source: "button" }, "providers"],
    [{ prompt: "   ", signedIn: true, fitsViewport: true, hasSelection: true, source: "enter" }, "ignore"],
    [{ prompt: "  Build a board  ", signedIn: true, fitsViewport: true, hasSelection: true, source: "enter" }, "launch"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(page.landingGenerateAction(input), expected, JSON.stringify(input));
  }
});

test("homepage source keeps launch behind the shared viewport guard", () => {
  const source = readFileSync(resolve(__dirname, "../app/page.tsx"), "utf8");
  assert.equal(source.includes("<main"), false);
  assert.match(source, /htmlFor="home-prompt"/);
  assert.match(source, /id="home-prompt"/);
  assert.match(source, /workspaceFitsViewport\(\)/);
  assert.match(source, /WORKSPACE_VIEWPORT_QUERY/);
  assert.match(source, /768px wide and 500px tall/);
  assert.match(source, /does not start a build/);
  assert.ok(source.indexOf("rememberAiLaunch(") > source.indexOf('action !== "launch"'));
  assert.equal(source.includes(">Preview</button>"), false);
  assert.equal(source.includes(">Code</button>"), false);
  assert.match(source, /animated=\{false\}/);
  assert.match(source, /prefers-reduced-motion: reduce/);
});

test("marketing copy does not claim image understanding, in-editor edits, or hosted deploy", () => {
  const data = load("lib/data.ts", { "lucide-react": new Proxy({}, { get: () => "Icon" }) });
  const text = [...data.FEATURES, ...data.STEPS].map((item) => `${item.label} ${item.desc}`).join("\n");
  assert.doesNotMatch(text, /CodeSandbox|built-in editor|reads them|live URL|screenshot|silently/i);
  assert.match(text, /read-only code view/);
  assert.match(text, /Download a ZIP/);
  assert.match(text, /GitHub/);
  assert.match(text, /npm registry/);
});

test("shared violet title stops clear 4.5:1 in both themes", () => {
  const source = readFileSync(resolve(__dirname, "../components/reusables.tsx"), "utf8");
  assert.match(source, /from-violet-800 via-violet-700 to-indigo-800/);
  assert.match(source, /dark:from-violet-200 dark:via-violet-300 dark:to-indigo-200/);
  assert.match(source, /text-violet-800 dark:text-violet-200/);
  const light = ["#5b21b6", "#6d28d9", "#3730a3"];
  const dark = ["#ddd6fe", "#c4b5fd", "#c7d2fe"];
  for (const hex of light) assert.ok(contrast(hex, "#ffffff") >= 4.5, hex);
  for (const hex of dark) assert.ok(contrast(hex, "#111111") >= 4.5, hex);
});

test("hole background does not run a continuous loop when motion is reduced or opted out", () => {
  const source = readFileSync(resolve(__dirname, "../components/animate-ui/components/backgrounds/hole.tsx"), "utf8");
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /animated && onScreen && !hidden && !reduce\.matches/);
  assert.match(source, /visibilityState === 'hidden'/);
});

test("invitation without a ticket is a heading, not an alert, and the join row can wrap", () => {
  const jsx = (type, props) => ({ type, props });
  const page = load("app/(auth)/accept-invitation/[[...accept-invitation]]/page.tsx", {
    react: {
      Suspense: "Suspense",
      useEffect() {},
      useCallback: (fn) => fn,
      useRef: () => ({ current: false }),
      useState: (initial) => [initial, () => {}],
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "@clerk/nextjs": {
      SignIn: "SignIn",
      SignUp: "SignUp",
      useUser: () => ({ isLoaded: true, user: null }),
      useClerk: () => ({ signOut() {}, async setActive() {} }),
    },
    "lucide-react": { Loader2: "Loader2" },
    "@/components/ui/button": { Button: "Button" },
  }, {}, "\nexport { AcceptInvitationContent };");
  const rendered = page.AcceptInvitationContent();
  assert.equal(rendered.type, "section");
  assert.equal(rendered.props.role, undefined);
  const heading = rendered.props.children.find((child) => child?.type === "h1");
  assert.equal(heading.props.children, "Invitation link needed");
  const source = readFileSync(resolve(__dirname, "../app/(auth)/accept-invitation/[[...accept-invitation]]/page.tsx"), "utf8");
  assert.match(source, /flex-col gap-3/);
  assert.match(source, /min-w-0 break-words/);
  assert.match(source, /aria-label=\{`Join \$\{invitation\.publicOrganizationData\.name\}`\}/);
  assert.doesNotMatch(source, /role="alert"[^>]*>Open the invitation link/);
});
