export const importBoundaries = {
  domain: {
    allowed: ["standard-library", "platform-neutral-contracts"],
    forbidden: ["nestjs", "prisma", "redis", "react", "http-client"],
  },
  web: {
    allowed: ["contracts", "domain-types", "ui"],
    forbidden: ["prisma", "database-drivers", "provider-secrets"],
  },
  api: {
    allowed: ["contracts", "domain", "application-services", "repositories"],
    forbidden: ["react", "browser-only-apis"],
  },
} as const;
