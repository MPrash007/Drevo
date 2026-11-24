// Actual source with isolated dependencies. No live Clerk, provider, DB or GitHub calls.
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { Webhook } = require("svix");
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(file, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, Error, Response, Request, AbortSignal, AbortController, ReadableStream, TextEncoder, Buffer, Date, setTimeout, clearTimeout, console: { error() {}, warn() {}, log() {} }, ...globals,
    require(name) { if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`); return dependencies[name]; } };
  vm.runInNewContext(code, context, { filename: file });
  return context.exports;
}
const validation = load("lib/validation.ts");
const app = { files: { "/App.js": { code: "export default function App() { return null }" } }, dependencies: {} };
const versionData = load("lib/version-data.ts", { "node:crypto": require("node:crypto"), diff: require("diff"), zod: require("zod"), "@/lib/validation": validation });
function versionModule(db) {
  return load("lib/versions.ts", { "@/lib/validation": validation, "@/lib/prisma": { db }, "@/lib/generated/prisma/client": { Prisma: { DbNull: null } }, "@/lib/version-data": versionData });
}
const plans = { free: { credits: 10 }, starter: { credits: 50 }, pro: { credits: 150 } };
const clerkLib = load("lib/clerk.ts", { "@clerk/nextjs/server": {}, "./constants": { PLANS: plans } });

test("public actions reject omitted/empty/object IDs before touching Prisma; pruning is internal", async () => {
  const db = new Proxy({}, { get() { throw new Error("Unexpected database access"); } });
  const deps = { "@clerk/nextjs/server": { auth: async () => ({ userId: "user_fixture" }) }, "next/navigation": { redirect() { throw new Error("Unauthorized"); } }, "@/lib/prisma": { db }, "@/lib/validation": validation };
  const versions = load("actions/versions.ts", { ...deps, "@/lib/versions": {} });
  const projects = load("actions/projects.ts", { ...deps, "next/cache": {}, "@/lib/org": {} });
  const workspace = load("actions/workspace.ts", { ...deps, "@/lib/org": {} });
  assert.equal(versions.pruneVersions, undefined);
  for (const id of [undefined, null, "", " ", {}, []]) {
    await assert.rejects(versions.getVersions(id), /Invalid workspace ID/);
    await assert.rejects(projects.deleteProject(id), /Invalid workspace ID/);
    await assert.rejects(workspace.getWorkspaceById(id), /Invalid workspace ID/);
    await assert.rejects(versions.restoreVersion(id, "v", 0), /Invalid workspace ID/);
  }
  await assert.rejects(versions.restoreVersion("w", undefined, 0), /Invalid version ID/);
});

test("signed-out users and non-admin members cannot read or delete projects via actions", async () => {
  const db = new Proxy({}, { get() { throw new Error("Unexpected database access"); } });
  const deps = { "@clerk/nextjs/server": { auth: async () => ({ userId: null }) }, "next/navigation": { redirect() { throw new Error("Unauthorized"); } }, "@/lib/prisma": { db }, "@/lib/validation": validation };
  const versions = load("actions/versions.ts", { ...deps, "@/lib/versions": {} });
  await assert.rejects(versions.getVersions("w"), /Unauthorized/);
  await assert.rejects(versions.restoreVersion("w", "v", 0), /Unauthorized/);
  const projects = load("actions/projects.ts", { ...deps, "@clerk/nextjs/server": { auth: async () => ({ userId: "user_fixture" }) }, "next/cache": {}, "@/lib/org": { getActiveOrganization: async () => ({ role: "MEMBER" }) } });
  await assert.rejects(projects.deleteProject("w"), /Forbidden/);
});

test("pruning filters both reads and deletes by exact workspace and cleanup failures stay non-fatal", async () => {
  const calls = [];
  const tx = { $queryRaw: async () => [], workspaceVersion: {
    async findMany(args) { calls.push(plain(args)); return Array.from({ length: 21 }, (_, i) => ({ id: `v${i}`, kind: "snapshot" })); },
    async deleteMany(args) { calls.push(plain(args)); },
  } };
  const versions = versionModule({ $transaction: (fn) => fn(tx) });
  await assert.rejects(versions.pruneVersions(undefined), /Invalid/);
  await versions.pruneVersions("w");
  assert.equal(calls[0].where.workspaceId, "w");
  assert.equal(calls[1].where.workspaceId, "w");
  assert.deepEqual(calls[1].where.id.in, ["v20"]);
  const failure = versionModule({ $transaction: async () => { throw new Error("DB cleanup down"); } });
  await failure.pruneVersionsBestEffort("w");
});

test("personal organization creation is serialized and enables personal providers", async () => {
  let membership = null, creates = 0, clerkCreates = 0;
  const tx = { $queryRaw: async () => [],
    organizationMember: { findFirst: async () => membership, create: async ({ data }) => { membership = data; } },
    user: { update: async () => {} },
    organization: { create: async ({ data }) => { assert.equal(data.allowPersonalAiProviders, true); return { id: `o${++creates}` }; } },
  };
  let tail = Promise.resolve();
  const db = { user: { findUnique: async () => ({ id: "u", clerkId: "user_u", name: "Fixture", activeOrganizationId: null, memberships: [] }) },
    organization: { update: async () => {} },
    $transaction: (fn) => { const result = tail.then(() => fn(tx)); tail = result.catch(() => {}); return result; },
  };
  const org = load("lib/org.ts", { "@clerk/nextjs/server": {}, react: { cache: (fn) => fn }, "next/navigation": {}, "@/lib/prisma": { db }, "@/lib/constants": { PLANS: plans }, "@/lib/validation": validation,
    "./clerk": { getClerk: async () => ({ organizations: { createOrganization: async () => ({ id: `org_${++clerkCreates}` }) } }) },
  });
  await Promise.all([org.ensurePersonalOrganization("u"), org.ensurePersonalOrganization("u")]);
  assert.equal(creates, 1); assert.equal(clerkCreates, 1);
});

test("GitHub deletes only paths tracked for the exact member/repository/branch and remote success survives tracking failure", async () => {
  for (const scenario of ["new-target", "known-target", "other-member", "other-branch", "tracking-fails", "rate-limited"]) {
    const trees = [], targetQueries = [];
    const userId = scenario === "other-member" ? "u2" : "u";
    const branch = scenario === "other-branch" ? "develop" : "main";
    const remote = { rest: {
      repos: { get: async () => { if (scenario === "rate-limited") throw Object.assign(new Error("API rate limit exceeded"), { status: 403 }); return { data: { html_url: "https://github.com/owner/b", default_branch: "main" } }; } },
      git: { getRef: async () => ({ data: { object: { sha: "head" } } }), getCommit: async () => ({ data: { tree: { sha: "tree" } } }),
        createBlob: async () => ({ data: { sha: "new" } }), getTree: async () => ({ data: { tree: [] } }),
        createTree: async ({ tree }) => { trees.push(plain(tree)); return { data: { sha: "new-tree" } }; }, createCommit: async () => ({ data: { sha: "commit" } }), updateRef: async ({ force }) => assert.equal(force, false),
      },
    } };
    const db = { user: { findUnique: async () => ({ id: userId, githubAccessToken: "encrypted", githubUsername: "owner", memberships: [{ organizationId: "o" }] }) },
      workspace: { findUnique: async () => ({ id: "w", organizationId: "o", fileData: app, githubPushedFiles: ["src/from-A.js"] }) },
      githubPushTarget: { findUnique: async (args) => { targetQueries.push(plain(args)); return scenario === "known-target" ? { pushedFiles: ["src/from-B.js"] } : null; }, upsert: async () => { if (scenario === "tracking-fails") throw new Error("DB down after push"); } },
    };
    const route = load("app/api/github/push/route.ts", { "@clerk/nextjs/server": { auth: async () => ({ userId: "user_fixture" }) }, "next/server": { NextResponse: Response }, zod: require("zod"), "@/lib/prisma": { db }, octokit: { Octokit: class { constructor() { return remote; } } },
      "@/lib/export-project": { buildProjectFilesFromFileData: () => ({ "src/App.js": "new code" }) },
      "@/lib/github": { decryptToken: () => "fixture", validateBranchName: () => null, validateRepoName: () => null, parseRepoFullName: () => ({ owner: "owner", repo: "b" }) },
    });
    const res = await route.POST(new Request("https://example.com/push", { method: "POST", body: JSON.stringify({ workspaceId: "w", mode: "existing", repoFullName: "Owner/B", branch }) }));
    assert.equal(res.status, scenario === "rate-limited" ? 429 : 200);
    assert.deepEqual(targetQueries[0].where.workspaceId_userId_repoFullName_branch, { workspaceId: "w", userId, repoFullName: "owner/b", branch });
    if (scenario !== "rate-limited") {
      const deleted = trees.flat().filter((entry) => entry.sha === null).map((entry) => entry.path);
      assert.deepEqual(deleted, scenario === "known-target" ? ["src/from-B.js"] : []);
      assert.equal((await res.json()).trackingSaved, scenario !== "tracking-fails");
    }
  }
});

test("organization deletion fails closed on provider errors and deletes Clerk before local data", async () => {
  for (const scenario of ["provider-error", "delete-error", "normal", "already-gone"]) {
    const calls = [];
    const members = { findUnique: async () => ({ role: "OWNER" }), count: async () => 0, findFirst: async () => null };
    const tx = { $queryRaw: async () => [{ clerkOrgId: "org_o" }], organizationMember: members, organization: { deleteMany: async () => calls.push("local-delete") } };
    const db = { organizationMember: members, $transaction: (fn) => fn(tx), user: { updateMany: async () => calls.push("pointer") } };
    tx.user = db.user;
    const route = load("app/api/orgs/delete/route.ts", { "next/server": { NextResponse: Response }, zod: require("zod"), "@/lib/prisma": { db }, "@/lib/org": { getActiveOrganization: async () => ({ role: "OWNER", userId: "u", clerkId: "user_u", organization: { id: "o" } }) }, "@/lib/clerk": {
      ...clerkLib, getClerk: async () => ({ organizations: {
        getOrganization: async () => { if (scenario === "provider-error") throw Object.assign(new Error("Unavailable"), { status: 429 }); if (scenario === "already-gone") throw Object.assign(new Error("Not found"), { status: 404 }); },
        getOrganizationMembershipList: async () => ({ totalCount: 1, data: [{ role: "org:admin", publicUserData: { userId: "user_u" } }] }),
        deleteOrganization: async () => { calls.push("clerk-delete"); if (scenario === "delete-error") throw new Error("Clerk failed"); },
      } }),
    } });
    const res = await route.DELETE(new Request("https://example.com/org", { method: "DELETE", body: JSON.stringify({ organizationId: "o" }) }));
    assert.equal(res.status, ["provider-error", "delete-error"].includes(scenario) ? 503 : 200);
    if (scenario === "normal") assert.deepEqual(calls, ["clerk-delete", "local-delete", "pointer"]);
    if (["provider-error", "delete-error"].includes(scenario)) assert.equal(calls.includes("local-delete"), false);
    if (scenario === "already-gone") assert.deepEqual(calls, ["local-delete", "pointer"]);
  }
});

function membershipFixture() {
  let upstream = [], fail = false;
  const users = new Map([["user_u", { id: "u", activeOrganizationId: "other" }]]);
  const members = new Map([["u", { id: "m", userId: "u", role: "ADMIN" }]]);
  const tx = {
    $queryRaw: async () => [{ id: "o" }],
    user: { findUnique: async ({ where }) => users.get(where.clerkId), updateMany: async ({ where, data }) => { const u = users.get("user_u"); if (u.id === where.id && (where.activeOrganizationId === undefined || u.activeOrganizationId === where.activeOrganizationId)) Object.assign(u, data); } },
    organizationMember: {
      findUnique: async ({ where }) => members.get(where.organizationId_userId.userId),
      upsert: async ({ where, create, update }) => { const id = where.organizationId_userId.userId; members.set(id, members.has(id) ? { ...members.get(id), ...update } : { id: "m", ...create }); },
      findMany: async ({ where }) => [...members.values()].filter((m) => !where.userId.notIn.includes(m.userId)),
      deleteMany: async () => members.clear(), findFirst: async () => ({ organizationId: "other" }),
    },
  };
  const sync = load("lib/membership-sync.ts", { "@/lib/validation": validation, "@/lib/prisma": { db: { $transaction: (fn) => fn(tx) } }, "@/lib/clerk": {
    ...clerkLib, getClerk: async () => ({ organizations: { getOrganizationMembershipList: async () => { if (fail) throw new Error("Clerk unavailable"); return { data: upstream }; } } }),
  } });
  return { sync: (activate = false) => sync.syncClerkMemberships("org_o", "user_u", activate), users, members,
    set: (role) => { upstream = role ? [{ role, organization: { id: "org_o" }, publicUserData: { userId: "user_u" } }] : []; }, fail: () => { fail = true; }, module: sync };
}
test("authoritative membership sync updates roles, removes revoked users, ignores stale event roles and preserves other active selections", async () => {
  const f = membershipFixture(); f.set("org:member"); await f.sync();
  assert.equal(f.members.get("u").role, "MEMBER"); assert.equal(f.users.get("user_u").activeOrganizationId, "other");
  f.set(null); await f.sync(); await f.sync(); assert.equal(f.members.size, 0);
  f.set("org:member"); await f.sync(true); assert.equal(f.members.size, 1); assert.equal(f.users.get("user_u").activeOrganizationId, "o");
  f.set(null); await f.sync(); assert.equal(f.users.get("user_u").activeOrganizationId, "other");
  f.members.set("u", { id: "m", userId: "u", role: "OWNER" }); f.set("org:admin"); await f.sync(); assert.equal(f.members.get("u").role, "OWNER");
  f.set("org:member"); await f.sync(); assert.equal(f.members.get("u").role, "MEMBER");
  f.fail(); await assert.rejects(f.sync(), /Clerk unavailable/); assert.equal(f.members.size, 1);
});

test("delayed membership-created and updated webhooks use current Clerk truth, not their old ADMIN payload", async () => {
  const f = membershipFixture(); f.set(null);
  const secret = `whsec_${Buffer.alloc(32, 3).toString("base64")}`;
  const route = load("app/api/webhooks/clerk/route.ts", { "next/server": { NextResponse: Response }, svix: { Webhook }, "@/lib/prisma": {}, "@/lib/clerk": {}, "@/lib/billing": {}, "@/lib/membership-sync": f.module }, { process: { env: { CLERK_WEBHOOK_SECRET: secret } } });
  for (const type of ["organizationMembership.created", "organizationMembership.updated", "organizationMembership.deleted"]) {
    const body = JSON.stringify({ type, data: { role: "org:admin", organization: { id: "org_o" }, public_user_data: { user_id: "user_u" } } });
    const now = new Date(), id = "msg_test";
    const res = await route.POST(new Request("https://example.com/webhook", { method: "POST", body, headers: { "svix-id": id, "svix-timestamp": String(Math.floor(now.getTime()/1000)), "svix-signature": new Webhook(secret).sign(id, now, body) } }));
    assert.equal(res.status, 200); assert.equal(f.members.size, 0);
  }
});

test("role changes call Clerk before Prisma and never change local role on provider failure", async () => {
  for (const fails of [false, true]) {
    const calls = [];
    const db = { organizationMember: { findFirst: async () => ({ id: "target", userId: "u2", role: "ADMIN", user: { clerkId: "user_target" } }) } };
    db.$transaction = (fn) => fn({
      $queryRaw: async () => [{ clerkOrgId: "org_o" }],
      organizationMember: { findUnique: async ({ where }) => ({ role: where.id === "caller" ? "OWNER" : "ADMIN" }), update: async () => calls.push("prisma") },
    });
    const route = load("app/api/orgs/members/role/route.ts", { "next/server": { NextResponse: Response }, zod: require("zod"), "@/lib/prisma": { db }, "@/lib/org": { getActiveOrganization: async () => ({ role: "OWNER", clerkId: "user_owner", userId: "u", membership: { id: "caller" }, organization: { id: "o" } }) }, "@/lib/clerk": {
      ...clerkLib, getClerk: async () => ({ organizations: { getOrganizationMembershipList: async () => ({ data: [{ role: "org:admin", publicUserData: { userId: "user_owner" } }] }), updateOrganizationMembership: async ({ role }) => { assert.equal(role, "org:member"); calls.push("clerk"); if (fails) throw new Error("Unavailable"); } } }),
    } });
    const res = await route.PATCH(new Request("https://example.com/role", { method: "PATCH", body: JSON.stringify({ memberId: "target", role: "MEMBER" }) }));
    assert.equal(res.status, fails ? 503 : 200); assert.deepEqual(calls, fails ? ["clerk"] : ["clerk", "prisma"]);
  }
});

test("invitation self-healing uses the authoritative sync helper rather than a stale direct membership upsert", async () => {
  let synced = 0, invited = 0;
  const route = load("app/api/orgs/members/add/route.ts", { "next/server": { NextResponse: Response }, zod: require("zod"),
    "@/lib/org": { getActiveOrganization: async () => ({ role: "OWNER", clerkId: "user_owner", organization: { id: "o" } }) },
    "@/lib/prisma": { db: { organization: { findUnique: async () => ({ clerkOrgId: "org_o" }) }, user: { findUnique: async () => null }, organizationMember: { upsert() { throw new Error("Must not mirror a stale snapshot directly"); } } } },
    "@/lib/membership-sync": { syncClerkMemberships: async (org, user) => { assert.equal(org, "org_o"); assert.equal(user, "user_target"); synced++; } },
    "@/lib/clerk": { ...clerkLib, getClerk: async () => ({ organizations: {
      getOrganizationInvitationList: async () => ({ data: [] }), getOrganizationMembershipList: async ({ userId }) => ({ data: userId
        ? [{ role: "org:admin", publicUserData: { userId: "user_owner" } }]
        : [{ role: "org:admin", publicUserData: { userId: "user_target", identifier: "target@example.com" } }] }),
      createOrganizationInvitation: async () => invited++,
    } }) },
  });
  const response = await route.POST(new Request("https://example.com/invite", { method: "POST", body: JSON.stringify({ email: "target@example.com" }) }));
  assert.equal(response.status, 409); assert.equal(synced, 1); assert.equal(invited, 0);
});

test("late active-pointer repair cannot overwrite a newer explicit organization switch", async () => {
  let selected = "new-choice";
  const org = load("lib/org.ts", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "user_u" }) }, react: { cache: (fn) => fn }, "next/navigation": {}, "@/lib/constants": { PLANS: plans }, "@/lib/validation": validation,
    "@/lib/prisma": { db: { user: {
      findUnique: async () => ({ id: "u", activeOrganizationId: "stale", memberships: [{ id: "m", role: "OWNER", organization: { id: "fallback", name: "Fallback", plan: "free", credits: 0 } }] }),
      updateMany: async ({ where, data }) => { assert.equal(where.activeOrganizationId, "stale"); if (selected === where.activeOrganizationId) selected = data.activeOrganizationId; return { count: 0 }; },
    } } },
  });
  await org.getActiveOrganization();
  assert.equal(selected, "new-choice");
});
