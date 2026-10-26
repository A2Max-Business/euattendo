import { createHash } from "node:crypto";
const PREFIX = "https://mcp-config.invalid/url/";
/** Opaque reference only; restoration must use the rule read inside this tenant. */
export function configurationUrlReference(url: string): string {
  return PREFIX + createHash("sha256").update(url).digest("hex");
}
export function isConfigurationUrlReference(url: string): boolean {
  return url.startsWith(PREFIX);
}
