import { z } from "zod";

export const APP_ENV_VALUES = ["LOCAL", "STAGING", "PRODUCTION"] as const;
export type AppEnvName = (typeof APP_ENV_VALUES)[number];

const optionalSecret = z.string().min(1).optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(APP_ENV_VALUES).optional(),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://weight_app:weight_app_local@localhost:5432/weight_app"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  AUTH_SESSION_SECRET: optionalSecret,
  AUTH_REFRESH_SECRET: optionalSecret,
  WEB_ALLOWED_ORIGINS: z.string().optional(),
  SESSION_COOKIE_DOMAIN: z.string().optional(),
  SESSION_COOKIE_SAMESITE: z.enum(["Lax", "Strict", "None"]).optional(),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  AI_PROVIDER: z.enum(["local", "deepseek", "openai", "local-llm"]).default("local"),
  DEEPSEEK_API_KEY: optionalSecret,
  DEEPSEEK_MODEL: z.string().min(1).default("deepseek-chat"),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  AI_DEEPSEEK_API_KEY: optionalSecret,
  AI_DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  AI_DEEPSEEK_MODEL: z.string().min(1).default("deepseek-chat"),
  OPENAI_API_KEY: optionalSecret,
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LOCAL_LLM_BASE_URL: z.string().url().optional(),
  LOCAL_LLM_MODEL: z.string().min(1).default("llama3"),
  EMAIL_FROM: z.string().email().optional(),
  TELEGRAM_BOT_TOKEN: optionalSecret,
  VK_CLIENT_ID: z.string().min(1).optional(),
  VK_CLIENT_SECRET: optionalSecret,
  OBJECT_STORAGE_ENDPOINT: z.string().url().optional(),
  OBJECT_STORAGE_BUCKET: z.string().min(1).optional(),
  OBJECT_STORAGE_ACCESS_KEY: optionalSecret,
  OBJECT_STORAGE_SECRET_KEY: optionalSecret,
  PAYMENT_PROVIDER: z.string().min(1).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  BACKUP_S3_ENDPOINT: z.string().url().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;
