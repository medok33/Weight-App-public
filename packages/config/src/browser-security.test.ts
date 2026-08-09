import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserSecurityConfigError,
  browserMutationOriginAllowed,
  loadBrowserSecurityConfig,
  normalizeOrigin,
  originAllowed,
} from "./browser-security.ts";

test("LOCAL defaults to localhost origin and insecure cookie", () => {
  const config = loadBrowserSecurityConfig({ NODE_ENV: "development", APP_ENV: "LOCAL" });
  assert.equal(config.appEnv, "LOCAL");
  assert.deepEqual(config.allowedOrigins, ["http://localhost:3000"]);
  assert.equal(config.cookie.name, "wa_session_local");
  assert.equal(config.cookie.secure, false);
  assert.equal(config.cookie.sameSite, "Lax");
  assert.equal(config.cookie.httpOnly, true);
  assert.equal(config.cookie.path, "/");
});

test("STAGING uses isolated cookie name", () => {
  const config = loadBrowserSecurityConfig({
    APP_ENV: "STAGING",
    WEB_ALLOWED_ORIGINS: "https://staging.example.com",
  });
  assert.equal(config.cookie.name, "wa_session_staging");
  assert.equal(config.cookie.secure, true);
});

test("PRODUCTION rejects missing origins, localhost, http, and Secure=false", () => {
  assert.throws(
    () => loadBrowserSecurityConfig({ APP_ENV: "PRODUCTION" }),
    (error: unknown) => error instanceof BrowserSecurityConfigError,
  );
  assert.throws(
    () =>
      loadBrowserSecurityConfig({
        APP_ENV: "PRODUCTION",
        WEB_ALLOWED_ORIGINS: "http://localhost:3000",
      }),
    (error: unknown) => error instanceof BrowserSecurityConfigError,
  );
  assert.throws(
    () =>
      loadBrowserSecurityConfig({
        APP_ENV: "PRODUCTION",
        WEB_ALLOWED_ORIGINS: "https://app.example.com",
        SESSION_COOKIE_SECURE: "false",
      }),
    (error: unknown) => error instanceof BrowserSecurityConfigError,
  );
  const ok = loadBrowserSecurityConfig({
    APP_ENV: "PRODUCTION",
    WEB_ALLOWED_ORIGINS: " https://app.example.com/ ",
  });
  assert.deepEqual(ok.allowedOrigins, ["https://app.example.com"]);
  assert.equal(ok.cookie.secure, true);
  assert.equal(ok.cookie.name, "wa_session_prod");
});

test("wildcard and malformed origins fail", () => {
  assert.throws(() => normalizeOrigin("*"), BrowserSecurityConfigError);
  assert.throws(() => normalizeOrigin("not-a-url"), BrowserSecurityConfigError);
  assert.throws(
    () =>
      loadBrowserSecurityConfig({
        APP_ENV: "STAGING",
        WEB_ALLOWED_ORIGINS: "*,https://staging.example.com",
      }),
    BrowserSecurityConfigError,
  );
});

test("origin and referer mutation checks", () => {
  const allowed = ["https://app.example.com"];
  assert.equal(originAllowed("https://app.example.com", allowed), true);
  assert.equal(originAllowed("https://evil.example.com", allowed), false);
  assert.equal(originAllowed("https://app.example.com.evil.test", allowed), false);
  assert.equal(
    browserMutationOriginAllowed({
      origin: undefined,
      referer: "https://app.example.com/admin",
      allowedOrigins: allowed,
    }),
    true,
  );
  assert.equal(
    browserMutationOriginAllowed({
      origin: undefined,
      referer: undefined,
      allowedOrigins: allowed,
    }),
    false,
  );
});
