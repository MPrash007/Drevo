import { auth } from "@clerk/nextjs/server";
import { stepCountIs, streamText } from "ai";
import { db } from "@/lib/prisma";
import { acquireAiLease, AI_TIMEOUT_RESPONSE, FileDataSchema, ImproveRequestSchema, protectAi, readAiBody, validateApp } from "@/lib/ai-request";
import { openModel, providerError, selectProvider } from "@/lib/ai-provider-server";
import { saveAiWorkspace } from "@/lib/workspace-save";
import { ProjectSourceError } from "@/lib/project-source";
import { checkProjectBundle } from "@/lib/project-bundle";
import { createDependencyResolver } from "@/lib/project-package-registry";
import { buildAgentInput, buildAgentInstructions, buildFileContext } from "./agent-prompts";
import { createImproveTools } from "./agent-tools";
import type { FileData, Message } from "@/types/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

const reply = (message: string, status: number) => Response.json({ message }, { status });

export async function POST(request: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return reply("Sign in to start building.", 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply("Expected a JSON request.", 415);
  const body = await readAiBody(request).catch(() => null);
  const parsed = ImproveRequestSchema.safeParse(body);
  if (!parsed.success) return reply("Invalid AI request.", 400);
  const input = parsed.data;
  const denied = await protectAi(request, body, clerkId, input.userRequest);
  if (denied) return denied;
  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!user) return reply("Account not found.", 404);
  const userId = user.id;

  let release: () => Promise<void>;
  try { release = await acquireAiLease(user.id, input.workspaceId); }
  catch { return reply("An AI request is already running. Try again when it finishes.", 409); }

  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(285000)]);
  let streaming = false;
  try {
    const [membership, workspace, pin, currentUser] = await Promise.all([
      db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: input.orgId, userId: user.id } },
        select: { role: true, organization: { select: { aiProviderConfig: true, allowPersonalAiProviders: true } } },
      }),
      input.workspaceId ? db.workspace.findFirst({
        where: { id: input.workspaceId, organizationId: input.orgId },
        select: { revision: true, fileData: true, title: true },
      }) : null,
      input.workspaceId ? db.workspaceAiSelection.findUnique({
        where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: user.id } },
      }) : null,
      db.user.findUnique({ where: { id: userId }, select: { activeOrganizationId: true, aiProviderConfig: true } }),
    ]);
    if (!currentUser) return reply("Account not found.", 404);
    if (!input.workspaceId && currentUser.activeOrganizationId !== input.orgId) {
      return reply("The active organization changed. Reload before creating a project.", 409);
    }
    if (!membership || (!input.workspaceId && membership.role === "MEMBER")) return reply("You do not have permission to start this AI run.", 403);
    if (input.workspaceId && !workspace) return reply("Project not found.", 404);
    if (workspace && workspace.revision !== input.revision) return reply("Project changed. Reload before retrying.", 409);
    const selection = input.selection;
    if (pin && (pin.scope !== selection.scope || pin.provider !== selection.provider || pin.model !== selection.model)) {
      return reply("Confirm the new model for this project before continuing.", 409);
    }
    const selected = selectProvider({
      userId: user.id, orgId: input.orgId, personal: currentUser.aiProviderConfig, organization: membership.organization.aiProviderConfig,
      allowPersonal: membership.organization.allowPersonalAiProviders, scope: selection.scope,
    });
    if ("message" in selected) return reply(selected.message ?? "AI connection unavailable.", 409);
    if (selected.config.provider !== selection.provider || selected.config.model !== selection.model) {
      return reply("The selected model changed. Refresh and confirm a connection before continuing.", 409);
    }
    let model: ReturnType<typeof openModel>;
    try { model = openModel(selected.config, selected.owner); }
    catch { return reply("The connection could not be opened. Reconnect the API key or contact the server administrator.", 503); }
    const existing = FileDataSchema.safeParse(workspace?.fileData);
    if (workspace?.fileData && !existing.success) return reply("The saved project files could not be read.", 409);
    const base: FileData = existing.success ? existing.data : { files: {}, dependencies: {} };
    const messages: Message[] = [
      ...(input.messages ?? []).slice(0, -1),
      { role: "user", content: input.userRequest, ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}) },
    ];
    const files = { ...base.files };
    const dependencies = { ...base.dependencies };
    let summary: string | undefined;
    const resolveDependencies = createDependencyResolver(signal);
    async function prepareProject(candidate: FileData) {
      const fileData = validateApp(candidate);
      await checkProjectBundle(fileData);
      fileData.dependencies = await resolveDependencies(fileData.dependencies);
      signal.throwIfAborted();
      return fileData;
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        async function run() {
          const enqueue = (type: string, data: object) => {
            if (!signal.aborted || type === "error") {
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`)); }
              catch { abort.abort(); }
            }
          };
          const tools = createImproveTools({
            files, dependencies, setSummary: (value) => { summary = value; },
            checkProject: async (candidate) => { await prepareProject(candidate); },
          }, (path) => {
            enqueue("status", { message: `Updated ${path}` });
          });
          try {
            signal.throwIfAborted();
            enqueue("status", { message: `Working with ${selection.model}` });
            const result = streamText({
              model,
              instructions: buildAgentInstructions({
                installedDependencies: Object.keys(base.dependencies).join(", ") || "none",
                fileContext: buildFileContext(base.files) || "No files yet. Create the application, including /App.js with a default export.",
              }),
              prompt: buildAgentInput({ messages, imageUrl: input.imageUrl, userRequest: input.userRequest }),
              tools: { update_file: tools.updateFileTool, add_dependency: tools.addDependencyTool, done_improving: tools.doneImprovingTool },
              toolChoice: "required",
              stopWhen: [stepCountIs(12), () => summary !== undefined && !tools.firstRejectedFile()],
              abortSignal: signal,
              maxRetries: 0,
              onError: () => {}, // Do not let the SDK log raw provider requests or responses.
            });
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error;
              if (part.type === "tool-error") throw new Error("The model generated an invalid tool call.");
              if (part.type === "tool-result" && typeof part.output === "string" && /^(Rejected|Not ready):/.test(part.output)) {
                enqueue("status", { message: "Checking and correcting generated files…" });
              }
            }
            signal.throwIfAborted();
          } catch (error) {
            if (signal.reason?.name === "TimeoutError") enqueue("error", AI_TIMEOUT_RESPONSE);
            else if (!signal.aborted) enqueue("error", { message: providerError(error) });
            return;
          }

          try {
            const rejected = tools.firstRejectedFile();
            if (rejected) throw new ProjectSourceError(rejected);
            const changed = Object.entries(files).some(([path, file]) => file.code !== base.files[path]?.code)
              || Object.entries(dependencies).some(([name, version]) => version !== base.dependencies[name]);
            if (!changed) {
              if (!summary?.startsWith("NO_OP:")) {
                enqueue("error", { message: "The model didn’t produce project files. Try a more specific prompt or confirm a different model." });
                return;
              }
              if (input.workspaceId) await db.workspaceAiSelection.upsert({
                where: { workspaceId_userId: { workspaceId: input.workspaceId, userId } },
                create: { workspaceId: input.workspaceId, userId, ...selection },
                update: {},
              });
              enqueue("done", { summary: summary.slice(6).trim() });
              return;
            }
            const title = workspace?.title ?? input.userRequest.slice(0, 80);
            const fileData = await prepareProject({ files, dependencies, title: base.title ?? title });
            if (!summary && !existing.success) {
              enqueue("error", { message: "The first build did not finish. Try a smaller prompt; no project was created." });
              return;
            }
            const finalSummary = summary && !summary.startsWith("NO_OP:") ? summary : "Applied changes.";
            const saved = await saveAiWorkspace({
              workspaceId: input.workspaceId, revision: input.revision, orgId: input.orgId, userId, selection,
              fileData, title, messages: [...messages, { role: "assistant", content: finalSummary }], summary: finalSummary, signal,
            });
            enqueue("done", { ...saved, fileData, summary: finalSummary, partial: !summary });
          } catch (error) {
            if (signal.reason?.name === "TimeoutError") enqueue("error", AI_TIMEOUT_RESPONSE);
            else if (!signal.aborted && error instanceof ProjectSourceError) {
              enqueue("error", { message: `The generated code could not be saved: ${error.message} Try again or choose a different model.`, code: "INVALID_PROJECT_SOURCE" });
            }
            else if (!signal.aborted) enqueue("error", { message: "Could not validate or save the changes. Reload the project and try again." });
          }
        }
        try { await run(); }
        finally {
          try { controller.close(); } catch { /* Client disconnected. */ }
          await release();
        }
      },
      cancel() { abort.abort(); },
    });
    streaming = true;
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
  } finally {
    if (!streaming) await release();
  }
}
