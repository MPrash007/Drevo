/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const zod = require("zod");
const crypto = require("node:crypto");
const ai = require("ai");

function load(file, dependencies = {}, globals = {}) {
  const text = ts.transpileModule(readFileSync(resolve(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    exports: {}, Request, Response, ReadableStream, TextEncoder, AbortController, AbortSignal, URL, URLSearchParams, Buffer,
    process: { env: { AI_PROVIDER_ENCRYPTION_KEY: "ba".repeat(32) } },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Missing fixture for ${name}`);
      return dependencies[name];
    }, ...globals,
  };
  vm.runInNewContext(text, context, { filename: file });
  return context.exports;
}
const models = load("lib/ai-providers.ts");
const launch = load("lib/ai-launch-intent.ts");
const validation = load("lib/validation.ts");
const attachments = load("lib/attachments.ts");
const specs = load("lib/project-dependency.ts", { semver: require("semver") });
const source = load("lib/project-source.ts", { "@babel/parser": require("@babel/parser"), "node:path": require("node:path"), "@/lib/validation": validation });
const exportsBuilder = load("lib/export-project.ts", { "@/lib/validation": validation, "@/lib/project-dependency": specs });
const bundle = {};
// esbuild's plugin filters must be RegExp objects from the same VM realm as its API.
vm.compileFunction(ts.transpileModule(readFileSync(resolve(__dirname, "../lib/project-bundle.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, ["exports", "require"])(bundle, (name) => ({
  "@/lib/project-source": source, "@/lib/export-project": exportsBuilder,
})[name] ?? require(name));
const registry = load("lib/project-package-registry.ts", { semver: require("semver"), "@/lib/project-source": source, "@/lib/project-dependency": specs });
const preview = load("lib/preview-error.ts");
const calls = [];
const provider = load("lib/ai-provider-server.ts", {
  "node:crypto": crypto, zod, ai, "@/lib/ai-providers": models,
  "@ai-sdk/openai-compatible": { createOpenAICompatible: ({ baseURL, apiKey }) => ({
    chatModel(model) { calls.push({ baseURL, apiKey, model }); return { model }; },
  }) },
});
const personal = { provider: "openai", model: "gpt-test", scope: "personal" };
const shared = { provider: "groq", model: "shared-test", scope: "organization" };
const personalKey = provider.sealProvider({ ...personal, apiKey: "fixture-key" }, "user:u");
const sharedKey = provider.sealProvider({ ...shared, apiKey: "fixture-org-key" }, "org:o");
const alternate = { provider: "xai", model: "grok-fixture", scope: "personal" };
const alternateKey = provider.sealProvider({ ...alternate, apiKey: "fixture-xai-key" }, "user:u");

test("homepage launches require a matching, one-use submission in the same browser tab", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const intent = { token: "one-time-token", prompt: "Build a timer", orgId: "o", selection: personal };
  assert.equal(launch.consumeAiLaunch(storage, intent), false);
  launch.rememberAiLaunch(storage, intent);
  for (const mismatch of [{ token: "different" }, { prompt: "Other" }, { orgId: "other" }, { selection: shared }]) {
    assert.equal(launch.consumeAiLaunch(storage, { ...intent, ...mismatch }), false);
  }
  assert.equal(launch.consumeAiLaunch(storage, intent), true);
  assert.equal(launch.consumeAiLaunch(storage, intent), false);
});

test("provider keys are not sent to browsers and cannot be moved to another account or model", () => {
  assert.equal(JSON.stringify(provider.publicProvider(personalKey)).includes("encryptedKey"), false);
  assert.equal(JSON.stringify(personalKey).includes("fixture-key"), false);
  assert.throws(() => provider.openModel(personalKey, "user:other"));
  assert.throws(() => provider.openModel({ ...personalKey, model: "other" }, "user:u"));
  provider.openModel(personalKey, "user:u");
  assert.deepEqual(calls.pop(), { baseURL: "https://api.openai.com/v1", apiKey: "fixture-key", model: "gpt-test" });
  assert.equal(provider.ProviderInputSchema.safeParse({ provider: "custom", model: "x", apiKey: "x", baseURL: "https://example.com" }).success, false);
});

test("personal policy is enforced server-side; a missing preference never uses the other key", () => {
  const options = { userId: "u", orgId: "o", personal: personalKey, organization: sharedKey, scope: "personal", provider: personal.provider };
  assert.match(provider.selectProvider({ ...options, allowPersonal: false }).message, /does not allow/);
  assert.match(provider.selectProvider({ ...options, personal: null, allowPersonal: true }).message, /No API key/);
  assert.equal(provider.selectProvider({ ...options, scope: "organization", allowPersonal: false }).owner, "org:o");
});

test("an unpinned project defaults only to an unambiguous allowed connection", () => {
  const settings = { allowPersonal: true, personal: [personal], organization: shared };
  assert.deepEqual({ ...models.defaultAiSelection(settings) }, personal);
  const multiple = { ...settings, personal: [personal, alternate] };
  assert.equal(models.defaultAiSelection(multiple), null);
  assert.equal(models.isAiSelectionAvailable(alternate, multiple), true);
  assert.equal(models.isAiSelectionAvailable({ ...alternate, model: "changed" }, multiple), false);
  assert.equal(models.isAiSelectionAvailable(alternate, { ...multiple, allowPersonal: false }), false);
  assert.deepEqual({ ...models.defaultAiSelection({ ...multiple, allowPersonal: false }) }, shared);
  assert.equal(models.defaultAiSelection({ ...settings, personal: [] }), null);
});

function runFixture(options = {}) {
  const base = { files: { "/App.js": { code: options.savedCode ?? "export default function App(){ return null; }" } }, dependencies: {} };
  const saved = [];
  const sent = [];
  const toolReplies = [];
  const db = {
    user: { findUnique: async () => ({ id: "u", activeOrganizationId: "o", aiProviderConfig: options.personalKey ?? personalKey }) },
    organizationMember: { findUnique: async () => ({
      role: options.role ?? "OWNER",
      organization: { aiProviderConfig: sharedKey, allowPersonalAiProviders: options.allowPersonal ?? true },
    }) },
    workspace: { findFirst: async () => ({ revision: 2, title: "Fixture", fileData: base }) },
    workspaceAiSelection: { findUnique: async () => options.pin ?? null },
  };
  const requests = load("lib/ai-request.ts", { zod, "@/lib/arcjet": {}, "@/lib/prisma": { db }, "node:crypto": crypto, "@/lib/validation": validation, "@/lib/ai-provider-server": provider, "@/lib/project-source": source, "@/lib/project-dependency": specs, "@/lib/attachments": attachments });
  const route = load("app/api/improve/route.ts", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    ai: {
      stepCountIs: () => () => false,
      streamText(args) {
        sent.push(args);
        return { fullStream: (async function* () {
          for (const code of options.writes ?? ["export default function App(){ return 'new'; }"]) {
            if (options.dependency) await args.tools.add_dependency.execute(options.dependency);
            if (options.localFile) await args.tools.update_file.execute(options.localFile);
            let output = await args.tools.update_file.execute({ path: "/App.js", code, reason: "Updated" });
            toolReplies.push(output);
            yield { type: "tool-result", output };
            output = await args.tools.done_improving.execute({ summary: "Updated." });
            toolReplies.push(output);
            yield { type: "tool-result", output };
            if (args.stopWhen[1]()) break;
          }
          yield { type: "finish" };
        })() };
      },
    },
    "@/lib/prisma": { db }, "@/lib/ai-provider-server": provider,
    "@/lib/ai-request": { ...requests, protectAi: async () => null, acquireAiLease: async () => async () => {} },
    "@/lib/project-source": source,
    "@/lib/project-bundle": bundle,
    "@/lib/project-package-registry": { createDependencyResolver: (signal) => registry.createDependencyResolver(signal, npmFixtureFetch) },
    "@/lib/workspace-save": { saveAiWorkspace: async (args) => { saved.push(args); return { workspaceId: args.workspaceId ?? "created", revision: args.workspaceId ? 3 : 0 }; } },
    "./agent-tools": load("app/api/improve/agent-tools.ts", { ai, zod, "@/lib/validation": validation, "@/lib/project-source": source, "@/lib/project-dependency": specs }),
    "./agent-prompts": load("app/api/improve/agent-prompts.ts", { "@/lib/attachments": attachments }),
  });
  return {
    sent, saved, toolReplies,
    post: (input) => route.POST(new Request("https://drevo.test/api/improve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "o", userRequest: "Build a site", workspaceId: null, revision: 0, selection: personal, ...input }),
    })),
  };
}

async function npmFixtureFetch(url) {
  assert.equal(url, "https://registry.npmjs.org/timer-fixture");
  return Response.json({ versions: { "1.0.0": {}, "1.2.3": {}, "2.0.0": {} }, "dist-tags": { latest: "2.0.0" } });
}

test("bundle and registry validation block broken output before a first build or edit can be saved", async () => {
  for (const issue of [
    { writes: ["export default 42;"], expected: /React component/ },
    { writes: ["import Timer from 'timer-fixture'; export default Timer;"], expected: /Undeclared browser dependency/ },
    { writes: ["import { Timer } from './Timer'; export default Timer;"], localFile: { path: "/Timer.js", code: "export default function Other(){}", reason: "Add timer" }, expected: /No matching export/ },
    { writes: ["import Timer from 'timer-fixture'; export default Timer;"], dependency: { package: "timer-fixture", version: "99.99.99" }, expected: /no matching published version/ },
  ]) {
    for (const input of [{}, { workspaceId: "w", revision: 2 }]) {
      const fx = runFixture(issue);
      const result = await (await fx.post(input)).text();
      assert.match(result, issue.expected);
      assert.doesNotMatch(result, /"type":"done"/);
      assert.equal(fx.saved.length, 0);
    }
  }
  const fx = runFixture({ writes: ["import Timer from 'timer-fixture'; export default Timer;"], dependency: { package: "timer-fixture", version: "^1.0.0" } });
  assert.match(await (await fx.post()).text(), /"type":"done"/);
  assert.equal(fx.saved[0].fileData.dependencies["timer-fixture"], "1.2.3");
});

test("registry checks resolve and pin exact versions, ranges and tags; export preserves an explicit entry", async () => {
  let requests = 0;
  const resolveVersion = registry.createDependencyResolver(new AbortController().signal, async (url) => { requests++; return npmFixtureFetch(url); });
  assert.equal((await resolveVersion({ "timer-fixture": "1.0.0" }))["timer-fixture"], "1.0.0");
  assert.equal((await resolveVersion({ "timer-fixture": "latest" }))["timer-fixture"], "2.0.0");
  await assert.rejects(resolveVersion({ "timer-fixture": "file:./local" }), /npm registry version/);
  assert.equal(requests, 1);
  assert.throws(() => source.checkProjectSource({ files: { "App.js": { code: "" }, "/App.js": { code: "" } } }), /same project path/);
  assert.throws(() => exportsBuilder.buildProjectFiles({ files: { "App.js": { code: "one" }, "/App.js": { code: "two" } } }), /multiple project files/);
  assert.equal(exportsBuilder.buildProjectFiles({ files: { "/index.js": { code: "// custom entry" } } })["src/index.js"], "// custom entry");
  assert.throws(() => exportsBuilder.buildProjectFiles({ files: {}, dependencies: { "timer-fixture": "file:./local" } }), /npm registry version/);
});

test("private image uploads and downloads require organization membership and a nonpublic bucket", async () => {
  const orgId = `c${"1".repeat(24)}`;
  let member = false, publicBucket = false;
  const stored = new Map();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b4x0AAAAASUVORK5CYII=", "base64");
  const { GET, POST } = load("app/api/attachments/route.ts", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-fixture" }) },
    "@supabase/supabase-js": { createClient: () => ({ storage: {
      getBucket: async () => ({ data: { public: publicBucket } }),
      from: (bucket) => {
        assert.equal(bucket, attachments.ATTACHMENT_BUCKET);
        return {
          upload: async (key, bytes) => { stored.set(key, new Blob([bytes])); return {}; },
          download: async (key) => ({ data: stored.get(key) }),
        };
      },
    } }) },
    "node:crypto": crypto,
    "@/lib/attachments": attachments,
    "@/lib/prisma": { db: { organizationMember: { findFirst: async ({ where }) => member && where.organizationId === orgId ? { id: "fixture" } : null } } },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "fixture" } } });

  const upload = (body = png, type = "image/png") => POST(new Request(`https://drevo.test/api/attachments?orgId=${orgId}`, {
    method: "POST", headers: { "Content-Type": type }, body,
  }));
  assert.equal((await upload()).status, 403);
  member = true;
  assert.equal((await upload("not a PNG")).status, 415);
  assert.equal((await upload("<svg/>", "image/svg+xml")).status, 415);
  assert.equal((await upload(new Uint8Array(attachments.MAX_ATTACHMENT_BYTES + 1))).status, 413);
  publicBucket = true;
  assert.equal((await upload()).status, 503);
  assert.equal(stored.size, 0);
  publicBucket = false;
  const accepted = await upload();
  assert.equal(accepted.status, 201);
  const { url } = await accepted.json();
  assert.equal(attachments.isPrivateAttachmentPath(url), true);
  const download = () => GET(new Request(`https://drevo.test${url}`));
  member = false;
  assert.equal((await download()).status, 404);
  member = true;
  const file = await download();
  assert.equal(file.headers.get("cache-control"), "private, no-store");
  assert.equal(file.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);

  const prompts = load("app/api/improve/agent-prompts.ts", { "@/lib/attachments": attachments });
  assert.doesNotMatch(prompts.buildAgentInput({ userRequest: "Describe a timer", imageUrl: url }), /api\/attachments/);
});

test("a valid stream with broken JSX cannot save a first build or overwrite an existing project", async () => {
  const broken = "export default function App() { return <button onClick=>Start</button>; }";
  for (const input of [{}, { workspaceId: "w", revision: 2 }]) {
    const fx = runFixture({ writes: [broken] });
    const result = await (await fx.post(input)).text();
    assert.match(result, /INVALID_PROJECT_SOURCE/);
    assert.match(result, /\/App\.js:1:/);
    assert.doesNotMatch(result, /"type":"done"/);
    assert.equal(fx.saved.length, 0);
    assert.match(fx.toolReplies[0], /^Rejected:/);
    assert.match(fx.toolReplies[1], /^Not ready:/);
  }
});

test("the same model can correct malformed JSX before a run is saved, including a broken legacy project", async () => {
  const broken = "export default function App(){ return <div>; }";
  const fixed = "export default function App() {\n  return <div>Timer</div>;\n}";
  const fx = runFixture({ savedCode: broken, writes: [broken, fixed] });
  const result = await (await fx.post({ workspaceId: "w", revision: 2 })).text();
  assert.match(fx.toolReplies[1], /^Not ready:/);
  assert.match(result, /Checking and correcting generated files/);
  assert.match(result, /"type":"done"/);
  assert.equal(fx.saved.length, 1);
  assert.equal(fx.saved[0].fileData.files["/App.js"].code, fixed);
});

test("source validation checks the real entry export and local imports; preview diagnostics omit the source dump", () => {
  assert.throws(() => source.checkProjectSource({ files: { "/App.js": { code: "// export default\nconst App = () => <div />;" } } }), /default export/);
  assert.throws(() => source.checkProjectSource({ files: { "/App.js": { code: "import Timer from './Timer'; export default Timer;" } } }), /missing local import/);
  source.checkProjectSource({ files: {
    "/App.js": { code: "import Timer from './Timer'; export { Timer as default };" },
    "/Timer.jsx": { code: "export default function Timer() { return <div />; }" },
  } });
  const message = "Cannot assign to read only property 'message' of object 'SyntaxError: /App.js: Unexpected token (1:14)'\n\n> 1 | source dump";
  assert.equal(preview.summarizePreviewError(message), "SyntaxError: /App.js: Unexpected token (1:14)");
});

test("first build and follow-up edits use the same model, tools, and save path", async () => {
  const fx = runFixture({ pin: personal });
  const start = await fx.post();
  assert.match(await start.text(), /"type":"done".*"workspaceId":"created"/);
  const edit = await fx.post({ workspaceId: "w", revision: 2 });
  assert.match(await edit.text(), /"type":"done".*"revision":3/);
  assert.equal(fx.sent.length, 2);
  assert.equal(fx.sent[0].model.model, fx.sent[1].model.model);
  assert.match(fx.sent[0].instructions, /No files yet/);
  assert.match(fx.sent[1].instructions, /export default function App/);
  assert.equal(fx.saved[0].selection.model, "gpt-test");
  assert.equal(fx.saved[1].workspaceId, "w");
});

test("mismatched pins, stale workspaces and disallowed keys stop before any model call", async () => {
  const fx = runFixture({ pin: personal, allowPersonal: false });
  assert.equal((await fx.post({ workspaceId: "w", revision: 2, selection: shared })).status, 409);
  assert.equal((await fx.post({ workspaceId: "w", revision: 2 })).status, 409);
  assert.equal((await fx.post({ workspaceId: "w", revision: 1 })).status, 409);
  const invalid = await fx.post({ selection: { ...personal, model: "replaced" } });
  assert.equal(invalid.status, 409);
  assert.equal(fx.sent.length, 0);
});

test("a same-model key rotation works without replacing the project selection", async () => {
  const rotated = provider.sealProvider({ ...personal, apiKey: "fixture-replacement" }, "user:u");
  const fx = runFixture({ pin: personal, personalKey: rotated });
  await (await fx.post({ workspaceId: "w", revision: 2 })).text();
  assert.equal(fx.saved[0].selection.model, personal.model);
  assert.equal(calls.at(-1).apiKey, "fixture-replacement");
});

test("the selected personal provider supplies the model and key; another connected key is not a fallback", async () => {
  const fx = runFixture({ pin: alternate, personalKey: [personalKey, alternateKey] });
  assert.equal((await fx.post({ workspaceId: "w", revision: 2 })).status, 409);
  assert.match(await (await fx.post({ workspaceId: "w", revision: 2, selection: alternate })).text(), /"type":"done"/);
  assert.deepEqual(calls.at(-1), { baseURL: "https://api.x.ai/v1", apiKey: "fixture-xai-key", model: alternate.model });
  const removed = runFixture({ pin: alternate, personalKey: [personalKey] });
  assert.equal((await removed.post({ workspaceId: "w", revision: 2, selection: alternate })).status, 409);
  assert.equal(removed.sent.length, 0);
});

test("the compatibility check requires a streamed tool result through the actual SDK", async () => {
  const actualCompatible = require("@ai-sdk/openai-compatible");
  let toolsSupported = true;
  const checked = load("lib/ai-provider-server.ts", {
    "node:crypto": crypto, zod, ai, "@/lib/ai-providers": models, "@ai-sdk/openai-compatible": actualCompatible,
  }, { fetch: async (url, request) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    assert.equal(new Headers(request.headers).get("authorization"), "Bearer fixture-key");
    assert.equal(request.redirect, "error");
    const body = JSON.parse(request.body);
    assert.equal(body.tool_choice, "required");
    assert.equal(body.stream, true);
    assert.equal(body.model, personal.model);
    const delta = toolsSupported ? {
      role: "assistant", tool_calls: [{
        index: 0, id: "check_1", type: "function",
        function: { name: "check_connection", arguments: JSON.stringify({ ready: true }) },
      }],
    } : { role: "assistant", content: "no tool" };
    const chunk = { id: "stream-1", model: personal.model, choices: [{ index: 0, delta, finish_reason: toolsSupported ? "tool_calls" : "stop" }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  await checked.checkModel(personalKey, "user:u", new AbortController().signal);
  toolsSupported = false;
  await assert.rejects(checked.checkModel(personalKey, "user:u", new AbortController().signal), (error) => /required tool call/.test(checked.providerError(error)));
});

test("Google Gemini passes the streamed connection check and preserves thought signatures across tool turns", async () => {
  const requests = [];
  let ready = true;
  let failure;
  const signature = Buffer.from("fixture-thought").toString("base64");
  const google = load("lib/ai-provider-server.ts", {
    "node:crypto": crypto, zod, ai, "@/lib/ai-providers": models,
    "@ai-sdk/openai-compatible": require("@ai-sdk/openai-compatible"),
  }, { fetch: async (url, request) => {
    const body = JSON.parse(request.body);
    const id = `fixture-${requests.length}`;
    requests.push({ url: String(url), request, body });
    if (failure === "unavailable") return Response.json({ error: { message: "fixture private response" } }, { status: 503 });
    if (failure === "invalid-stream") return new Response("data: not valid JSON\n\n", { headers: { "content-type": "text/event-stream" } });
    const name = body.tools[0].function.name;
    const delta = { role: "assistant", tool_calls: [{
      index: 0, id, type: "function",
      function: { name, arguments: JSON.stringify({ ready }) },
      extra_content: { google: { thought_signature: signature } },
    }] };
    const chunk = { id, model: body.model, choices: [{ index: 0, delta, finish_reason: "tool_calls" }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  const modelId = models.AI_PROVIDERS.google.suggestedModel;
  const input = google.ProviderInputSchema.parse({ provider: "google", model: modelId, apiKey: "fixture-google-key" });
  const config = google.sealProvider(input, "user:u");
  await google.checkModel(config, "user:u", new AbortController().signal);

  const result = ai.streamText({
    model: google.openModel(config, "user:u"),
    instructions: "Build a fixture.",
    prompt: "Make a timer.",
    tools: { update_file: ai.tool({ inputSchema: zod.object({ ready: zod.literal(true) }), execute: async () => "OK" }) },
    toolChoice: "required",
    stopWhen: ai.stepCountIs(2),
    maxRetries: 0,
    onError: () => {},
  });
  for await (const part of result.fullStream) if (part.type === "error") throw part.error;
  assert.equal(requests.length, 3);
  for (const { url, request, body } of requests) {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(new Headers(request.headers).get("authorization"), "Bearer fixture-google-key");
    assert.equal(request.redirect, "error");
    assert.equal(body.model, modelId);
    assert.equal(body.stream, true);
    assert.equal(body.tool_choice, "required");
  }
  assert.equal(requests[0].body.tools[0].function.name, "check_connection");
  assert.equal(requests[0].body.max_tokens, 2048);
  assert.deepEqual(requests[0].body.tools[0].function.parameters, {
    type: "object",
    properties: { ready: { type: "boolean" } },
    required: ["ready"],
  });
  assert.ok(requests[1].body.messages.some(({ role, content }) => role === "system" && content === "Build a fixture."));
  const replayed = requests[2].body.messages.find(({ role }) => role === "assistant");
  assert.equal(replayed.tool_calls[0].extra_content.google.thought_signature, signature);
  assert.ok(requests[2].body.messages.some(({ role, tool_call_id }) => role === "tool" && tool_call_id === "fixture-1"));

  const hydrogen = google.sealProvider({ ...input, model: "gemini-4-hydrogen" }, "user:u");
  const checkHydrogen = () => google.checkModel(hydrogen, "user:u", new AbortController().signal);
  await checkHydrogen();
  assert.equal(requests.at(-1).body.model, "gemini-4-hydrogen");
  ready = false;
  await assert.rejects(checkHydrogen(), (error) => /required tool call/.test(google.providerError(error)));
  for (const [kind, expected] of [["unavailable", /HTTP 503/], ["invalid-stream", /incomplete or incompatible response/]]) {
    failure = kind;
    await assert.rejects(checkHydrogen(), (error) => {
      const message = google.providerError(error);
      assert.match(message, expected);
      assert.doesNotMatch(message, /fixture private response|not valid JSON|fixture-google-key/);
      return true;
    });
  }
});

test("connection diagnostics distinguish a missing tool, truncated output and timeout", async () => {
  let parts = [];
  const checked = load("lib/ai-provider-server.ts", {
    "node:crypto": crypto, zod, "@/lib/ai-providers": models,
    ai: { ...ai, streamText: () => ({ fullStream: (async function* () { yield* parts; })() }) },
    "@ai-sdk/openai-compatible": { createOpenAICompatible: () => ({ chatModel: () => ({}) }) },
  });
  for (const [reason, message] of [["stop", /required tool call/], ["length", /output limit/]]) {
    parts = [{ type: "finish", finishReason: reason }];
    await assert.rejects(checked.checkModel(personalKey, "user:u", new AbortController().signal), (error) => {
      assert.match(checked.providerError(error), message);
      return true;
    });
  }
  const controller = new AbortController();
  controller.abort(new DOMException("fixture private details", "TimeoutError"));
  await assert.rejects(checked.checkModel(personalKey, "user:u", controller.signal), (error) => {
    const message = checked.providerError(error);
    assert.match(message, /timed out/);
    assert.doesNotMatch(message, /fixture private details/);
    return true;
  });
});

test("organization settings enforce role boundaries and expose only connection metadata", async () => {
  const orgId = `c${"1".repeat(24)}`, workspaceId = `c${"2".repeat(24)}`;
  const org = { allowPersonalAiProviders: false, aiProviderConfig: sharedKey };
  let role = "MEMBER", pin;
  const user = { id: "u", aiProviderConfig: personalKey, activeOrganizationId: orgId };
  const writes = [];
  const db = {
    user: { findUnique: async () => user, findUniqueOrThrow: async () => user, update: async ({ data }) => Object.assign(user, data) },
    organizationMember: { findUnique: async () => ({ role, organization: org }) },
    workspace: { findFirst: async () => ({ id: workspaceId }) },
    workspaceAiSelection: { findUnique: async () => pin, upsert: async ({ update }) => { pin = update; } },
    organization: {
      findUniqueOrThrow: async () => org,
      update: async ({ data }) => { writes.push(data); Object.assign(org, data); },
    },
    $queryRaw: async () => [],
    $transaction: (work) => work(db),
  };
  const tested = [];
  let validConnection = true;
  const route = load("app/api/ai/providers/route.ts", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/prisma": { db }, zod,
    "@/lib/ai-request": { acquireAiLease: async () => async () => {} },
    "@/lib/ai-provider-server": { ...provider, checkModel: async (config) => {
      tested.push(config);
      if (!validConnection) throw new Error("Private provider error");
    } },
  });
  const endpoint = "https://drevo.test/api/ai/providers";
  const post = (input) => route.POST(new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, ...input }) }));
  const change = { action: "connect", scope: "organization", config: { provider: "groq", model: "new-model", apiKey: "fixture-next" } };
  assert.equal((await post(change)).status, 403);
  assert.equal(tested.length, 0);
  assert.equal((await post({ action: "select", workspaceId, selection: personal })).status, 409);
  assert.equal((await post({ action: "select", workspaceId, selection: shared })).status, 200);
  const current = await route.GET(new Request(`${endpoint}?orgId=${orgId}&workspaceId=${workspaceId}`));
  const raw = await current.text();
  assert.equal(current.headers.get("cache-control"), "private, no-store");
  assert.doesNotMatch(raw, /fixture-key|encryptedKey/);
  assert.deepEqual(JSON.parse(raw).selection, shared);
  const home = await route.GET(new Request(endpoint));
  assert.equal(home.status, 200);
  assert.equal((await home.json()).orgId, orgId);

  role = "ADMIN";
  assert.equal((await post({ action: "policy", allowPersonal: true })).status, 403);
  assert.equal((await post(change)).status, 200);
  assert.equal(tested.length, 1);
  assert.notEqual(writes[0].aiProviderConfig.encryptedKey, "fixture-next");
  assert.equal((await post({ action: "select", workspaceId, selection: shared })).status, 409);
  role = "OWNER";
  assert.equal((await post({ action: "policy", allowPersonal: true })).status, 200);
  assert.equal((await post({ action: "select", workspaceId, selection: personal })).status, 200);

  role = "MEMBER";
  const connectXai = { action: "connect", scope: "personal", config: { ...alternate, apiKey: "fixture-xai-key" } };
  validConnection = false;
  const failed = await post(connectXai);
  assert.equal(failed.status, 422);
  assert.doesNotMatch(await failed.text(), /Private provider error/);
  assert.equal(user.aiProviderConfig, personalKey);
  validConnection = true;
  assert.equal((await post(connectXai)).status, 200);
  assert.equal(user.aiProviderConfig[0].encryptedKey, personalKey.encryptedKey);
  const configured = await (await route.GET(new Request(`${endpoint}?orgId=${orgId}&workspaceId=${workspaceId}`))).text();
  assert.doesNotMatch(configured, /encryptedKey|fixture-xai-key/);
  assert.deepEqual(JSON.parse(configured).personal, [
    { provider: personal.provider, model: personal.model },
    { provider: alternate.provider, model: alternate.model },
  ]);
  assert.deepEqual(JSON.parse(configured).selection, personal);
  assert.equal((await post({ action: "select", workspaceId, selection: alternate })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(pin)), alternate);
  assert.equal((await post({ action: "disconnect", scope: "personal" })).status, 400);
  assert.equal((await post({ action: "disconnect", scope: "personal", provider: alternate.provider })).status, 200);
  assert.equal(user.aiProviderConfig.length, 1);
  assert.equal(user.aiProviderConfig[0].encryptedKey, personalKey.encryptedKey);
  assert.equal((await post({ action: "select", workspaceId, selection: alternate })).status, 409);

  db.user.findUnique = async () => { throw Object.assign(new Error("private database details"), { code: "P2022" }); };
  const unavailable = await route.GET(new Request(endpoint));
  assert.equal(unavailable.status, 503);
  const message = (await unavailable.json()).message;
  assert.match(message, /migration is missing/);
  assert.doesNotMatch(message, /private database details/);
});
