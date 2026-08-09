export const CORE_API_URL = (process.env.CORE_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
export const CORE_ORG_ID = process.env.CORE_ORG_ID ?? "acme";
const secret = (raw: string | undefined): string | undefined => (raw?.trim() ? raw : undefined);

export const CORE_SIGNING_SECRET = secret(process.env.CORE_SIGNING_SECRET);
export const PORTAL_IDENTITY_SECRET = secret(process.env.PORTAL_IDENTITY_SECRET) ?? CORE_SIGNING_SECRET;
if (!secret(process.env.PORTAL_IDENTITY_SECRET) && CORE_SIGNING_SECRET) {
  console.warn(
    "[chassis] PORTAL_IDENTITY_SECRET unset — signing portal identity with CORE_SIGNING_SECRET (dev fallback)",
  );
}

export function portFromEnv(fallback: number): number {
  return Number(process.env.PORT ?? fallback);
}

export function externalExecutionFromEnv(
  rawUrl = process.env.EXTERNAL_EXECUTION_URL,
  rawLabel = process.env.EXTERNAL_EXECUTION_LABEL,
): { url: string; label: string } | null {
  if (rawUrl === undefined && rawLabel === undefined) return null;
  const url = rawUrl?.trim();
  if (!url) throw new Error("EXTERNAL_EXECUTION_URL must be a same-origin absolute path");
  const base = new URL("https://portal.invalid");
  const resolved = new URL(url, base);
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\") || resolved.origin !== base.origin) {
    throw new Error("EXTERNAL_EXECUTION_URL must be a same-origin absolute path");
  }
  const label = rawLabel?.trim();
  if (!label) throw new Error("EXTERNAL_EXECUTION_LABEL must not be empty");
  return { url, label: label.slice(0, 80) };
}
