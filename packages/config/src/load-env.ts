import { z } from "zod";

import { envSchema, type EnvConfig } from "./env.schema.js";

export const ENV_INVALID_ERROR_CODE = "ENV_INVALID" as const;

export class EnvConfigError extends Error {
  readonly code = ENV_INVALID_ERROR_CODE;
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    super("Environment configuration is invalid");
    this.name = "EnvConfigError";
    this.issues = issues;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  const result = envSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue: z.ZodIssue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  throw new EnvConfigError(issues);
}
