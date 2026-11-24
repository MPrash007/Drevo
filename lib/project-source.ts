import { parse } from "@babel/parser";
import { posix } from "node:path";
import { canonicalProjectPath } from "@/lib/validation";
import type { FileData } from "@/types/workspace";

export class ProjectSourceError extends Error {}

function parseModule(path: string, code: string) {
  try {
    return parse(code, { sourceType: "unambiguous", plugins: ["jsx"] }).program;
  } catch (error) {
    const { reasonCode, loc } = error as { reasonCode?: string; loc?: { line: number; column: number } };
    const detail = reasonCode?.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() ?? "invalid syntax";
    throw new ProjectSourceError(`${path}${loc ? `:${loc.line}:${loc.column + 1}` : ""} — ${detail}.`);
  }
}

export function checkFileSource(path: string, code: string) {
  if (/\.[cm]?jsx?$/i.test(path)) {
    parseModule(path, code);
  } else if (/\.json$/i.test(path)) {
    try { JSON.parse(code); }
    catch { throw new ProjectSourceError(`${path} — invalid JSON.`); }
  }
}

export function checkProjectSource({ files }: Pick<FileData, "files">) {
  const paths = new Set(Object.keys(files).map(canonicalProjectPath));
  if (paths.size !== Object.keys(files).length) throw new ProjectSourceError("Multiple generated files have the same project path.");
  for (const [path, file] of Object.entries(files)) {
    if (!/\.[cm]?jsx?$/i.test(path)) {
      checkFileSource(path, file.code);
      continue;
    }
    const program = parseModule(path, file.code);
    if (canonicalProjectPath(path) === "/App.js" && !program.body.some((node) => node.type === "ExportDefaultDeclaration"
      || (node.type === "ExportNamedDeclaration" && node.specifiers.some((entry) =>
        entry.type === "ExportSpecifier" && (entry.exported.type === "Identifier" ? entry.exported.name : entry.exported.value) === "default")))) {
      throw new ProjectSourceError("/App.js must export the app as its default export.");
    }
    if (canonicalProjectPath(path) === "/App.js") {
      const entry = program.body.find((node) => node.type === "ExportDefaultDeclaration");
      if (entry && (/Literal$|^(ArrayExpression|ObjectExpression|JSXElement|JSXFragment)$/.test(entry.declaration.type)
        || (entry.declaration.type === "Identifier" && entry.declaration.name === "undefined"))) {
        throw new ProjectSourceError("/App.js must export a React component, not a literal, object, or JSX element.");
      }
    }
    for (const node of program.body) {
      if (node.type !== "ImportDeclaration" && node.type !== "ExportNamedDeclaration" && node.type !== "ExportAllDeclaration") continue;
      const specifier = node.source?.value;
      if (!specifier || !(specifier.startsWith("./") || specifier.startsWith("../"))) continue;
      const target = posix.resolve("/", posix.dirname(path), specifier);
      if (!projectImportCandidates(target).some((candidate) => paths.has(candidate))) {
        throw new ProjectSourceError(`${path}:${node.loc?.start.line ?? 1} — missing local import ${specifier.slice(0, 120)}.`);
      }
    }
  }
}

export function projectImportCandidates(target: string) {
  const extensions = [".js", ".jsx", ".mjs", ".cjs", ".json", ".css"];
  return [target, ...extensions.map((extension) => target + extension), ...extensions.map((extension) => `${target}/index${extension}`)];
}
