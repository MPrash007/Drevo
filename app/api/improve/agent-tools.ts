import { tool } from "ai";
import { z } from "zod";
import { canonicalProjectPath, isSafeFilePath } from "@/lib/validation";
import { checkFileSource, ProjectSourceError } from "@/lib/project-source";
import { isRegistryVersion, PACKAGE_NAME } from "@/lib/project-dependency";
import type { FileData } from "@/types/workspace";

// Mutable per-run accumulation, owned by the route (finishRun, getChangedPaths
// and the NO_OP check all read these same objects, so the factory mutates in
// place rather than returning copies).
export interface ImprovePatchState {
  files: Record<string, { code: string }>;
  dependencies: Record<string, string>;
  setSummary: (summary: string) => void;
  checkProject: (candidate: FileData) => Promise<void>;
}

export function createImproveTools(
  state: ImprovePatchState,
  emitFilePatch: (path: string, code: string, reason: string) => void
) {
  const rejectedFiles = new Map<string, string>();
  // Tool 1: update_file — the agent calls this once per file it wants to
  // change. Emit progress immediately; the client replaces Sandpack files
  // only after a committed `done`, never from unsaved patches.
  const updateFileTool = tool({
    description:
      "Update or rewrite a file in the React sandbox. Call once per file you need to change.",
    inputSchema: z.object({
      path: z
        .string()
        .refine(isSafeFilePath)
        .describe("File path exactly as it appears, e.g. /App.js"),
      code: z.string().max(1_000_000).describe("Complete new contents of the file"),
      reason: z
        .string().max(500)
        .describe("One sentence explaining what you changed and why"),
    }),
    execute: async ({ path, code, reason }) => {
      const canonical = canonicalProjectPath(path);
      // Update a legacy path in place so an edit cannot introduce an alias.
      path = Object.hasOwn(state.files, canonical.slice(1)) && !Object.hasOwn(state.files, canonical) ? canonical.slice(1) : canonical;
      try {
        checkFileSource(path, code);
      } catch (error) {
        if (!(error instanceof ProjectSourceError)) throw error;
        rejectedFiles.set(path, error.message);
        return `Rejected: ${error.message} Rewrite the complete file with valid syntax, then call update_file again.`;
      }
      rejectedFiles.delete(path);
      state.files[path] = { code };
      // Progress only — this is not a database-save receipt.
      emitFilePatch(path, code, reason);
      return `Updated ${path}: ${reason}`;
    },
  });

  // Tool 2: add_dependency — lets the agent add an npm package when the edit
  // needs one (e.g. framer-motion). Validated against npm registry in
  // finishRun before anything is saved.
  const addDependencyTool = tool({
    description:
      "Add an npm package the edited code needs. Only use packages that exist on npm.",
    inputSchema: z.object({
      package: z.string().regex(PACKAGE_NAME).describe("npm package name, e.g. framer-motion"),
      version: z
        .string()
        .max(100)
        .default("latest")
        .describe("Version range, default latest"),
    }),
    execute: async ({ package: pkg, version }) => {
      if (!isRegistryVersion(version)) return "Rejected: use an npm registry version, range or dist-tag.";
      state.dependencies[pkg] = version.trim();
      return `Added dependency ${pkg}@${version.trim()}`;
    },
  });

  // Tool 3: done_improving — the agent calls this when all files are updated.
  // A rejected completion gives the model another step to correct its changes.
  const doneImprovingTool = tool({
    description: "Call this when you have finished making all changes.",
    inputSchema: z.object({
      summary: z
        .string().max(4000)
        .describe(
          "A short friendly summary of all the changes you made (1-3 sentences)"
        ),
    }),
    execute: async ({ summary }) => {
      try {
        const rejected = rejectedFiles.values().next().value;
        if (rejected) throw new ProjectSourceError(rejected);
        if (!summary.startsWith("NO_OP:")) await state.checkProject({ files: state.files, dependencies: state.dependencies });
      } catch (error) {
        if (!(error instanceof ProjectSourceError)) throw error;
        return `Not ready: ${error.message} Fix the project before calling done_improving again.`;
      }
      state.setSummary(summary);
      return "Done.";
    },
  });

  return { updateFileTool, addDependencyTool, doneImprovingTool, firstRejectedFile: () => rejectedFiles.values().next().value };
}

export type ImproveTools = ReturnType<typeof createImproveTools>;
