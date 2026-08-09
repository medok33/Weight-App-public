import type { BrowserSecurityConfig } from './browser-security.policy';
import {
  BrowserSecurityConfigError,
  loadBrowserSecurityConfig,
} from './browser-security.policy';
import { SESSION_POLICY } from './auth.policy';

let cached: BrowserSecurityConfig | null = null;

export function getBrowserSecurityConfig(): BrowserSecurityConfig {
  if (!cached) {
    cached = loadBrowserSecurityConfig(process.env, {
      sessionTtlSeconds: SESSION_POLICY.ttlSeconds,
    });
  }
  return cached;
}

export function resetBrowserSecurityConfigCache(): void {
  cached = null;
}

export function assertBrowserSecurityConfigAtStartup(
  source: NodeJS.ProcessEnv = process.env,
): BrowserSecurityConfig {
  try {
    const config = loadBrowserSecurityConfig(source, {
      sessionTtlSeconds: SESSION_POLICY.ttlSeconds,
    });
    cached = config;
    return config;
  } catch (error) {
    if (error instanceof BrowserSecurityConfigError) {
      throw error;
    }
    throw new BrowserSecurityConfigError([String(error)]);
  }
}

export { BrowserSecurityConfigError, loadBrowserSecurityConfig };
export type { BrowserSecurityConfig };
