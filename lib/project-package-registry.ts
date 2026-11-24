import { maxSatisfying, valid, validRange } from "semver";
import { isRegistryVersion, PACKAGE_NAME } from "@/lib/project-dependency";
import { ProjectSourceError } from "@/lib/project-source";

export function createDependencyResolver(signal: AbortSignal, fetchRegistry = fetch) {
  const registry = new Map<string, Promise<{ versions?: Record<string, unknown>; "dist-tags"?: Record<string, string> }>>();
  return async (dependencies: Record<string, string>) => Object.fromEntries(await Promise.all(
    Object.entries(dependencies).map(async ([name, input]) => {
      if (!PACKAGE_NAME.test(name) || !isRegistryVersion(input)) {
        throw new ProjectSourceError(`${name} must use an npm registry version, range, or dist-tag.`);
      }
      const requested = input.trim();
      if (!registry.has(name)) registry.set(name, (async () => {
        try {
          const response = await fetchRegistry(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
            headers: { Accept: "application/vnd.npm.install-v1+json" },
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: "error",
          });
          if (response.status === 404) throw new ProjectSourceError(`${name} is not published on npm.`);
          if (!response.ok) throw new Error();
          return await response.json();
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof ProjectSourceError) throw error;
          registry.delete(name);
          throw new ProjectSourceError(`Could not verify ${name} with the npm registry. Try again.`);
        }
      })());
      const manifest = await registry.get(name)!;
      const versions = manifest.versions ?? {};
      const exact = valid(requested);
      const resolved = exact ?? (validRange(requested)
        ? maxSatisfying(Object.keys(versions), requested)
        : manifest["dist-tags"]?.[requested]);
      if (!resolved || !valid(resolved) || !Object.hasOwn(versions, resolved)) {
        throw new ProjectSourceError(`${name}@${requested} has no matching published version.`);
      }
      return [name, resolved];
    }),
  ));
}
