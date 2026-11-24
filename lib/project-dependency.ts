import { validRange } from "semver";

export const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;

export function isRegistryVersion(spec: string) {
  const request = spec.trim();
  return request.length > 0 && request.length <= 100
    && (validRange(request) !== null || /^[a-z][a-z0-9._-]*$/i.test(request));
}
