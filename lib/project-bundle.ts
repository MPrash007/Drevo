import { build, type Loader } from "esbuild";
import { posix } from "node:path";
import { BASE_DEPENDENCIES } from "@/lib/export-project";
import { projectImportCandidates, ProjectSourceError } from "@/lib/project-source";
import type { FileData } from "@/types/workspace";

const loaders: Record<string, Loader> = {
  ".js": "jsx", ".jsx": "jsx", ".mjs": "js", ".cjs": "js", ".json": "json", ".css": "css",
  ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl",
  ".gif": "dataurl", ".ico": "dataurl", ".txt": "text", ".woff": "dataurl", ".woff2": "dataurl",
};

export async function checkProjectBundle({ files, dependencies }: FileData) {
  const external = new Set(["react", "react-dom", ...Object.keys(BASE_DEPENDENCIES), ...Object.keys(dependencies)]);
  try {
    await build({
      entryPoints: Object.hasOwn(files, "/index.js") ? ["/App.js", "/index.js"] : ["/App.js"],
      platform: "browser", format: "esm", jsx: "automatic", tsconfigRaw: {},
      bundle: true, write: false, outdir: "drevo-validation", logLevel: "silent",
      plugins: [{
        name: "drevo-in-memory",
        setup(plugin) {
          // Every import resolves from the provided files or a declared external. No project filesystem access.
          plugin.onResolve({ filter: /.*/ }, ({ path, importer, kind }) => {
            if (path.startsWith("/") || path.startsWith("./") || path.startsWith("../")) {
              const target = posix.resolve("/", posix.dirname(importer), path);
              const found = projectImportCandidates(target).find((candidate) => Object.hasOwn(files, candidate));
              if (found) return { path: found, namespace: "drevo-project" };
              return { errors: [{ text: `Missing local import ${path}` }] };
            }
            if (kind === "url-token" && /^(https?:|data:|#)/i.test(path)) return { path, external: true };
            const name = path.startsWith("@") ? path.split("/").slice(0, 2).join("/") : path.split("/")[0];
            if (external.has(name)) return { path, external: true };
            return { errors: [{ text: `Undeclared browser dependency ${path}` }] };
          });
          plugin.onLoad({ filter: /.*/, namespace: "drevo-project" }, ({ path }) => {
            const loader = loaders[posix.extname(path).toLowerCase()];
            if (!loader) return { errors: [{ text: `Unsupported imported file type: ${path}` }] };
            return { contents: files[path].code, loader };
          });
        },
      }],
    });
  } catch (error) {
    const issue = (error as { errors?: { text: string; location?: { file: string; line: number } }[] }).errors?.[0];
    const file = issue?.location?.file.replace(/^drevo-project:/, "");
    throw new ProjectSourceError(issue
      ? `${file ? `${file}:${issue.location!.line} — ` : ""}${issue.text.slice(0, 240)}`
      : "Could not bundle the generated project.");
  }
}
