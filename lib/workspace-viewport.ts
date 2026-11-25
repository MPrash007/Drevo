export const WORKSPACE_VIEWPORT_QUERY = "(min-width: 768px) and (min-height: 500px)";

export function workspaceFitsViewport() {
  return typeof window !== "undefined" && window.matchMedia(WORKSPACE_VIEWPORT_QUERY).matches;
}
