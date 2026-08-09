/**
 * Browser security policy shared with API (ARCH-SEC-02A).
 * Canonical copy: packages/config/src/browser-security.ts
 * Keep origin normalization and APP_ENV rules identical.
 */

export type AppEnvName = "LOCAL" | "STAGING" | "PRODUCTION";

export type SessionSameSite = "Lax" | "Strict" | "None";

export type BrowserSecurityConfig = {
  appEnv: AppEnvName;
  allowedOrigins: string[];
  cookie: {
    name: string;
    httpOnly: true;
    secure: boolean;
    sameSite: SessionSameSite;
    path: "/";
    domain?: string;
    maxAgeSeconds: number;
  };
};

export class BrowserSecurityConfigError extends Error {
  readonly code = "BROWSER_SECURITY_CONFIG_INVALID" as const;
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Browser security configuration is invalid: ${issues.join("; ")}`);
    this.name = "BrowserSecurityConfigError";
    this.issues = issues;
  }
}

const DEFAULT_LOCAL_ORIGIN = "http://localhost:3000";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function resolveAppEnv(source: NodeJS.ProcessEnv = process.env): AppEnvName {
  const explicit = String(source.APP_ENV ?? "")
    .trim()
    .toUpperCase();
  if (explicit === "LOCAL" || explicit === "STAGING" || explicit === "PRODUCTION") {
    return explicit;
  }
  if (explicit) {
    throw new BrowserSecurityConfigError([`Unknown APP_ENV="${source.APP_ENV}"`]);
  }
  const nodeEnv = String(source.NODE_ENV ?? "development").toLowerCase();
  if (nodeEnv === "production") return "PRODUCTION";
  if (nodeEnv === "test") return "LOCAL";
  return "LOCAL";
}

export function normalizeOrigin(raw: string): string {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new BrowserSecurityConfigError(["Empty origin is not allowed"]);
  }
  if (trimmed === "*" || trimmed.includes("*")) {
    throw new BrowserSecurityConfigError(["Wildcard origin is not allowed with credentials"]);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BrowserSecurityConfigError([`Malformed origin: ${raw}`]);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserSecurityConfigError([`Origin protocol must be http or https: ${raw}`]);
  }
  if (url.username || url.password) {
    throw new BrowserSecurityConfigError([`Origin must not include credentials: ${raw}`]);
  }
  if (url.pathname && url.pathname !== "/") {
    throw new BrowserSecurityConfigError([`Origin must not include a path: ${raw}`]);
  }
  if (url.search || url.hash) {
    throw new BrowserSecurityConfigError([`Origin must not include query/hash: ${raw}`]);
  }
  return `${url.protocol}//${url.host}`;
}

export function parseAllowedOrigins(raw: string | undefined, appEnv: AppEnvName): string[] {
  const value = String(raw ?? "").trim();
  if (!value) {
    if (appEnv === "LOCAL") return [DEFAULT_LOCAL_ORIGIN];
    throw new BrowserSecurityConfigError([
      "WEB_ALLOWED_ORIGINS is required for STAGING/PRODUCTION",
    ]);
  }
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => normalizeOrigin(part));
  if (parts.length === 0) {
    throw new BrowserSecurityConfigError(["WEB_ALLOWED_ORIGINS resolved to an empty allowlist"]);
  }
  return [...new Set(parts)];
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function sessionCookieNameForEnv(appEnv: AppEnvName): string {
  if (appEnv === "STAGING") return "wa_session_staging";
  if (appEnv === "PRODUCTION") return "wa_session_prod";
  return "wa_session_local";
}

export function loadBrowserSecurityConfig(
  source: NodeJS.ProcessEnv = process.env,
  options?: { sessionTtlSeconds?: number },
): BrowserSecurityConfig {
  const issues: string[] = [];
  let appEnv: AppEnvName;
  try {
    appEnv = resolveAppEnv(source);
  } catch (error) {
    if (error instanceof BrowserSecurityConfigError) throw error;
    throw new BrowserSecurityConfigError([String(error)]);
  }

  let allowedOrigins: string[] = [];
  try {
    allowedOrigins = parseAllowedOrigins(source.WEB_ALLOWED_ORIGINS, appEnv);
  } catch (error) {
    if (error instanceof BrowserSecurityConfigError) issues.push(...error.issues);
    else issues.push(String(error));
  }

  const sameSiteRaw = String(source.SESSION_COOKIE_SAMESITE ?? "Lax").trim() || "Lax";
  const sameSite = sameSiteRaw as SessionSameSite;
  if (!["Lax", "Strict", "None"].includes(sameSite)) {
    issues.push(`Invalid SESSION_COOKIE_SAMESITE="${source.SESSION_COOKIE_SAMESITE}"`);
  }

  const secureOverride = String(source.SESSION_COOKIE_SECURE ?? "")
    .trim()
    .toLowerCase();
  let secure: boolean;
  if (secureOverride === "true") secure = true;
  else if (secureOverride === "false") secure = false;
  else secure = appEnv === "STAGING" || appEnv === "PRODUCTION";

  const domainRaw = String(source.SESSION_COOKIE_DOMAIN ?? "").trim();
  const domain = domainRaw || undefined;
  if (domain) {
    if (domain.startsWith(".") && domain.split(".").length < 3) {
      issues.push("SESSION_COOKIE_DOMAIN is too broad");
    }
    if (/\s/.test(domain)) {
      issues.push("SESSION_COOKIE_DOMAIN must not contain whitespace");
    }
  }

  if (appEnv === "STAGING" || appEnv === "PRODUCTION") {
    if (allowedOrigins.some((origin) => isLocalhostOrigin(origin))) {
      issues.push("localhost origins are not allowed in STAGING/PRODUCTION");
    }
    if (allowedOrigins.some((origin) => origin.startsWith("http:"))) {
      issues.push("STAGING/PRODUCTION origins must use HTTPS");
    }
    if (!secure) {
      issues.push("SESSION_COOKIE_SECURE must be true in STAGING/PRODUCTION");
    }
    if (sameSite === "None" && !secure) {
      issues.push("SameSite=None requires Secure=true");
    }
  }

  if (sameSite === "None" && !secure) {
    issues.push("SameSite=None requires Secure=true");
  }

  if (issues.length > 0) {
    throw new BrowserSecurityConfigError(issues);
  }

  return {
    appEnv,
    allowedOrigins,
    cookie: {
      name: sessionCookieNameForEnv(appEnv),
      httpOnly: true,
      secure,
      sameSite,
      path: "/",
      domain,
      maxAgeSeconds: options?.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS,
    },
  };
}

export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  try {
    const normalized = normalizeOrigin(origin);
    return allowed.includes(normalized);
  } catch {
    return false;
  }
}

export function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    const url = new URL(String(referer).trim());
    return normalizeOrigin(`${url.protocol}//${url.host}`);
  } catch {
    return undefined;
  }
}

/** True when Origin is allowed, or Origin absent and Referer maps to an allowed origin. */
export function browserMutationOriginAllowed(input: {
  origin?: string;
  referer?: string;
  allowedOrigins: readonly string[];
}): boolean {
  const originHeader = String(input.origin ?? "").trim();
  if (originHeader) {
    return originAllowed(originHeader, input.allowedOrigins);
  }
  const fromReferer = refererOrigin(input.referer);
  if (!fromReferer) return false;
  return input.allowedOrigins.includes(fromReferer);
}
