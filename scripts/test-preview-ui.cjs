// Isolated preview/export UI regression. No provider calls, no GitHub, no live data.
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, rmSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { createServer } = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const esbuild = require("esbuild");

const root = resolve(__dirname, "..");
const panel = readFileSync(resolve(root, "components/CodePanel.tsx"), "utf8");
const dialog = readFileSync(resolve(root, "components/GithubPushDialog.tsx"), "utf8");
const sandpack = readFileSync(resolve(root, "node_modules/@codesandbox/sandpack-react/dist/index.js"), "utf8");

test("installed Sandpack drops a delayed iframe update while the client is still compiling", () => {
  assert.match(sandpack, /if \(recompileMode === "delayed"\)/);
  assert.match(sandpack, /if \(client\.status === "done"\)/);
  assert.match(sandpack, /window\.clearTimeout\(debounceHook\.current\)/);
  const applied = [];
  const client = { status: "initializing", updateSandbox(next) { applied.push(next); } };
  if (client.status === "done") client.updateSandbox({ files: { "/App.js": { code: "REAL" } } });
  assert.deepEqual(applied, []);
});

test("preview identity does not reuse an empty Sandpack mount or key on file contents", () => {
  assert.doesNotMatch(panel, /PLACEHOLDER_FILES/);
  assert.doesNotMatch(panel, /height:\s*"100vh"/);
  assert.doesNotMatch(panel, /height:\s*"89%"/);
  assert.doesNotMatch(panel, /height:\s*"90%"/);
  assert.match(panel, /data-preview-ready="false"/);
  assert.match(panel, /data-preview-ready="true"/);
  assert.match(panel, /key=\{filePathKey\}/);
  assert.match(panel, /Object\.keys\(fileData\.files\)\.sort\(\)\.join\("\|"\)/);
  assert.doesNotMatch(panel, /filesSignature\(fileData\.files\)/);
  assert.match(panel, /customSetup = useMemo/);
  assert.match(panel, /dependenciesFromKey\(dependencyKey\)/);
  assert.match(panel, /client\.updateSandbox/);
  assert.match(panel, /Could not create the ZIP/);
  assert.match(panel, /aria-label=\{versions\.length > 0 \? `Version history/);
  assert.match(panel, /aria-label="Desktop preview"/);
  assert.match(panel, /aria-label="Mobile preview"/);
  assert.match(panel, /aria-label=\{focusMode \? "Show chat" : "Focus preview"\}/);
  assert.match(panel, /aria-pressed=\{showHistory\}/);
  assert.match(panel, /aria-pressed=\{device === "desktop"\}/);
  assert.match(panel, /aria-pressed=\{focusMode\}/);
  assert.match(panel, /aria-label="Refresh preview"/);
  assert.match(panel, /Read-only\. Describe a change in chat/);
  assert.match(panel, /flex-wrap/);
  assert.match(panel, /motion-reduce:animate-none/);
  assert.match(panel, /motion-reduce:hidden/);
  assert.doesNotMatch(panel.replaceAll("dark:text-violet-300", ""), /text-violet-300/);
  assert.doesNotMatch(panel.replaceAll("dark:text-red-200", ""), /text-red-200/);
  assert.doesNotMatch(panel, /bg-red-950/);
  assert.match(panel, /buildProjectFiles\(/);
  assert.match(panel, /pushToGithub\(/);
  assert.match(panel, /trackingSaved === false/);
});

test("GitHub dialog status is theme-safe and controls are named without changing the push contract", () => {
  assert.match(dialog, /mode: "create"/);
  assert.match(dialog, /mode: "existing"/);
  assert.match(dialog, /pushToGithub\(/);
  assert.doesNotMatch(dialog, /text-amber-200/);
  assert.doesNotMatch(dialog, /text-amber-300/);
  assert.doesNotMatch(dialog, /text-emerald-300/);
  assert.doesNotMatch(dialog, /text-red-400/);
  assert.match(dialog, /text-amber-950/);
  assert.match(dialog, /dark:text-amber-50/);
  assert.match(dialog, /text-emerald-950/);
  assert.match(dialog, /dark:text-emerald-50/);
  assert.match(dialog, /aria-pressed=\{tab === t\}/);
  assert.match(dialog, /aria-pressed=\{active\}/);
  assert.match(dialog, /aria-invalid=\{Boolean\(repoNameError\)\}/);
  assert.match(dialog, /text-base/);
  assert.match(dialog, /min-h-11/);
  assert.match(dialog, /motion-reduce:animate-none/);
  assert.match(dialog, /Retry upload into this repository/);
  assert.match(dialog, /window\.location\.href = `\/api\/github\/connect/);
});

test("browser fixture: ready mount keeps /App.js, dropped compile flushes, toolbar fits 360–522", async (t) => {
  const chromeBin = process.env.CHROME_BIN || "google-chrome";
  if (spawnSync(chromeBin, ["--version"], { stdio: "ignore" }).error?.code === "ENOENT") {
    t.skip("Chrome not installed; set CHROME_BIN to run the browser fixture.");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "drevo-preview-ui-"));
  const bundlePath = join(dir, "harness.js");
  const profile = join(dir, "chrome");
  let server;
  let chrome;
  try {
    await esbuild.build({
      stdin: {
        contents: `
          import { createRoot } from "react-dom/client";
          import { useState } from "react";
          import { CodePanel } from "./components/CodePanel";
          const real = { files: { "/App.js": { code: "export default function App(){ return <div>REAL_MARKER</div> }" } }, dependencies: { "date-fns": "latest" }, title: "Fixture" };
          const revised = { files: { "/App.js": { code: "export default function App(){ return <div>REVISION_MARKER</div> }" } }, dependencies: real.dependencies, title: "Fixture" };
          function Harness() {
            const [fileData, setFileData] = useState(null);
            const [width, setWidth] = useState(800);
            globalThis.__setFileData = setFileData;
            globalThis.__setWidth = setWidth;
            globalThis.__real = real;
            globalThis.__revised = revised;
            return (
              <div id="panel" style={{ width, height: 640, display: "flex", overflow: "hidden" }}>
                <CodePanel fileData={fileData} isGenerating={false} statusLog={[]} onFixError={async () => {}}
                  appTitle="Fixture" isImproving={false}
                  versions={[{ id: "v1", summary: "Added a board", createdAt: new Date(), fileCount: 1 }]}
                  versionsLoading={false} onRestoreVersion={async () => {}} focusMode={false} onToggleFocusMode={() => {}}
                  workspaceId="ws_fixture" githubConnected={false} githubUsername={null} lastPush={{ repoUrl: "https://example.invalid/acme/app", fullName: "acme/app", branch: "main", pushedAt: "2026-11-25T00:00:00.000Z" }}
                  onPushed={() => {}} onGithubConnectionChange={() => {}} />
              </div>
            );
          }
          globalThis.__sandpackClients = [];
          globalThis.__sandpackSetups = [];
          globalThis.__sandpackUpdates = [];
          createRoot(document.getElementById("root")).render(<Harness />);
        `,
        resolveDir: root,
        loader: "tsx",
        sourcefile: "preview-ui-harness.tsx",
      },
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      outfile: bundlePath,
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
      plugins: [{
        name: "preview-ui-fixtures",
        setup(build) {
          build.onResolve({ filter: /^next-themes$/ }, () => ({ path: "next-themes", namespace: "mock" }));
          build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents: "export function useTheme(){ return { resolvedTheme: 'light', theme: 'light', setTheme() {} }; }",
            loader: "js",
          }));
          build.onResolve({ filter: /^@\// }, (args) => {
            const base = resolve(root, args.path.slice(2));
            const path = [base, `${base}.tsx`, `${base}.ts`, `${base}.js`].find((candidate) => existsSync(candidate));
            if (!path) return { errors: [{ text: `Cannot resolve ${args.path}` }] };
            return { path };
          });
          build.onLoad({ filter: /sandpack-client\/dist\/index\.(js|mjs)$/ }, async (args) => {
            const spy = `function loadSandpackClient(iframe, setup) {
              const listeners = new Set();
              const client = {
                status: "initializing",
                iframe,
                listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
                dispatch() {},
                destroy() { client.destroyed = true; },
                updateSandbox(next) { globalThis.__sandpackUpdates.push(next); },
                emit(msg) { for (const fn of listeners) fn(msg); },
              };
              globalThis.__sandpackClients.push(client);
              globalThis.__sandpackSetups.push(setup);
              return Promise.resolve(client);
            }`;
            const source = readFileSync(args.path, "utf8");
            if (args.path.endsWith(".mjs")) {
              assert.match(source, /export \{ loadSandpackClient \};/);
              return {
                contents: source.replace(/function loadSandpackClient[\s\S]*?\n}\n\nexport \{ loadSandpackClient \};/, `${spy}\n\nexport { loadSandpackClient };`),
                loader: "js",
              };
            }
            assert.match(source, /exports\.loadSandpackClient = loadSandpackClient;/);
            return {
              contents: source.replace(/function loadSandpackClient[\s\S]*?\n}\n/, `${spy}\n`) + "\nexports.loadSandpackClient = loadSandpackClient;\n",
              loader: "js",
            };
          });
        },
      }],
    });

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:#fff;color:#111}
      .flex{display:flex}.inline-flex{display:inline-flex}.flex-wrap{flex-wrap:wrap}.flex-col{flex-direction:column}
      .items-center{align-items:center}.justify-center{justify-content:center}.justify-end{justify-content:flex-end}
      .shrink-0{flex-shrink:0}.min-w-0{min-width:0}.max-w-full{max-width:100%}.ml-auto{margin-left:auto}
      .flex-1{flex:1 1 0%}.min-h-0{min-height:0}.h-full{height:100%}.w-full{width:100%}
      .size-11{width:2.75rem;height:2.75rem}.h-11,.min-h-11{min-height:2.75rem}.h-11{height:2.75rem}
      .gap-1{gap:.25rem}.gap-x-2{column-gap:.5rem}.gap-y-1{row-gap:.25rem}.px-2{padding-left:.5rem;padding-right:.5rem}
      .px-3{padding-left:.75rem;padding-right:.75rem}.whitespace-nowrap{white-space:nowrap}
      .overflow-hidden{overflow:hidden}.relative{position:relative}.absolute{position:absolute}
      .border-b{border-bottom:1px solid #ddd}.text-base{font-size:1rem}
      button{font:inherit}
    </style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>`;
    server = createServer((req, res) => {
      if (req.url.startsWith("/harness.js")) {
        res.setHeader("content-type", "text/javascript");
        res.end(readFileSync(bundlePath));
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end(html);
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const port = server.address().port;
    chrome = spawn(chromeBin, [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
      "--no-first-run", "--disable-extensions", `--user-data-dir=${profile}`,
      "--remote-debugging-port=0", "--host-resolver-rules=MAP *.codesandbox.io 127.0.0.1",
      `http://127.0.0.1:${port}/`,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let debug = "";
    chrome.stderr.on("data", (chunk) => { debug += chunk.toString(); });
    const wsUrl = await new Promise((resolveUrl, rejectUrl) => {
      const timer = setTimeout(() => rejectUrl(new Error(`Chrome did not open DevTools.\n${debug}`)), 15000);
      chrome.stderr.on("data", () => {
        const match = debug.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolveUrl(match[1]); }
      });
      chrome.on("exit", (code) => { clearTimeout(timer); rejectUrl(new Error(`Chrome exited ${code}`)); });
      chrome.on("error", (error) => { clearTimeout(timer); rejectUrl(error); });
    });
    const version = await (await fetch(wsUrl.replace("ws://", "http://").replace(/\/devtools\/browser\/.*$/, "/json/version"))).json();
    const browser = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolveOpen) => { browser.onopen = resolveOpen; });
    let nextId = 0;
    const pending = new Map();
    browser.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) pending.get(message.id)(message);
    };
    const send = (method, params = {}) => new Promise((resolveSend) => {
      const id = ++nextId;
      pending.set(id, (message) => { pending.delete(id); resolveSend(message); });
      browser.send(JSON.stringify({ id, method, params }));
    });
    const targets = await send("Target.getTargets");
    const page = targets.result.targetInfos.find((item) => item.type === "page");
    const attached = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    const sessionId = attached.result.sessionId;
    const call = (method, params = {}) => new Promise((resolveSend) => {
      const id = ++nextId;
      pending.set(id, (message) => { pending.delete(id); resolveSend(message); });
      browser.send(JSON.stringify({ id, sessionId, method, params }));
    });
    await call("Runtime.enable");
    const evaluate = async (expression) => {
      const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
      return result.result.result.value;
    };
    const waitFor = async (expression) => {
      const started = Date.now();
      while (Date.now() - started < 10000) {
        if (await evaluate(expression)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`Timed out waiting for ${expression}\n${await evaluate("document.body.innerText")}`);
    };
    await waitFor("Boolean(globalThis.__setFileData)");
    assert.equal(await evaluate("globalThis.__sandpackClients.length"), 0);
    assert.equal(await evaluate("Boolean(document.querySelector('[data-preview-ready=\"false\"]'))"), true);
    await evaluate("globalThis.__setFileData(globalThis.__real)");
    await waitFor("globalThis.__sandpackClients.length === 1");
    const firstCode = await evaluate("globalThis.__sandpackSetups[0].files['/App.js'].code");
    assert.match(firstCode, /REAL_MARKER/);
    assert.doesNotMatch(firstCode, /Your app will appear here/);
    await evaluate("globalThis.__setFileData(globalThis.__revised)");
    await evaluate("new Promise((resolve) => setTimeout(resolve, 700))");
    assert.equal(await evaluate("globalThis.__sandpackUpdates.length"), 0, "Sandpack should still drop the delayed update while initializing");
    await evaluate("globalThis.__sandpackClients[0].status = 'done'; globalThis.__sandpackClients[0].emit({ type: 'done' }); true");
    await waitFor("globalThis.__sandpackUpdates.some((update) => JSON.stringify(update.files).includes('REVISION_MARKER'))");
    assert.equal(await evaluate("globalThis.__sandpackClients.length"), 1);

    const clipped = await evaluate(`(() => {
      const failures = [];
      const panel = document.getElementById("panel");
      const widths = [360, 442, 522, 768];
      for (const width of widths) {
        panel.style.width = width + "px";
        const box = panel.getBoundingClientRect();
        const toolbar = panel.querySelector("[data-preview-toolbar]");
        for (const button of toolbar.querySelectorAll("button")) {
          const rect = button.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const name = button.getAttribute("aria-label") || button.textContent.trim();
          if (rect.right > box.right + 1 || rect.left < box.left - 1) failures.push(width + " clips " + name);
          if (rect.width < 44 || rect.height < 40) failures.push(width + " target " + name + " " + Math.round(rect.width) + "x" + Math.round(rect.height));
        }
      }
      return failures;
    })()`);
    assert.deepEqual(clipped, []);
    const styles = await evaluate("[...document.querySelectorAll('#panel [style]')].map((el) => el.getAttribute('style')).join('\\n')");
    assert.doesNotMatch(styles, /100vh|89%|90%/);
    await evaluate("document.querySelector('[aria-label^=\"Version history\"]').click()");
    const historyFits = await evaluate(`(() => {
      const panel = document.getElementById("panel");
      panel.style.width = "360px";
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return "missing";
      const box = panel.getBoundingClientRect();
      const rect = dialog.getBoundingClientRect();
      return rect.right <= box.right + 1 && rect.left >= box.left - 1 ? "fits" : "overflow";
    })()`);
    assert.equal(historyFits, "fits");
    await evaluate("document.querySelector('[aria-label=\"Close version history\"]').click()");
    browser.close();
  } finally {
    if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill("SIGKILL");
      await new Promise((resolveExit) => chrome.on("exit", resolveExit));
    }
    server?.close();
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* Chrome can still be releasing the profile. */ }
  }
});
