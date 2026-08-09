# Auth Architecture

## Overview

Weight App uses a **single** server-side session authentication stack for all roles (`USER`, `ADMIN`, `OWNER`).

There is one `AuthModule`. There is **no** separate owner auth stack.

Admin and owner surfaces use the same `wa_session` cookie, `SessionAuthGuard`, and `request.user`, plus:

- `RolesGuard` / `@Roles(...)` for RBAC
- `OwnerMfaGuard` for MFA on sensitive owner actions

Legacy `owner_session` cookies are cleared on logout and are not an auth stack.

## Session storage

| Cookie | Audience | Storage |
|--------|----------|---------|
| `wa_session` | All authenticated users | HttpOnly, `SameSite=Lax`, `Secure` only in production; SHA-256 hash in `Session` |

Session TTL: 30 days (`SESSION_POLICY` in `auth.policy.ts`).

## Identity

- `User` — `username` (unique, case-insensitive), optional `email`, `accountRole`, `status`
- `AuthIdentity` — provider `email` + `credentialHash` (scrypt)
- `UserSubscription` — `FREE` / `PREMIUM`
- `Session` — `tokenHash`, `userId`, `role`

## API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /auth/register` | Public | Create USER account, set `wa_session` |
| `POST /auth/login` | Public | Body `{ identifier, password }` — username or email |
| `POST /auth/logout` | Public | Revoke current session |
| `GET /auth/me` | Session | Current user + `role` + `tier` |

Login failures return `INVALID_CREDENTIALS` without revealing whether the identifier exists. Failed attempts are rate-limited.

## OWNER bootstrap

One-shot idempotent command (env-only credentials, never hardcoded):

```bash
OWNER_BOOTSTRAP_ENABLED=true \
OWNER_BOOTSTRAP_USERNAME=... \
OWNER_BOOTSTRAP_PASSWORD=... \
pnpm owner:bootstrap
```

Password is never printed. Existing OWNER password is not changed unless `OWNER_BOOTSTRAP_FORCE_PASSWORD=true`.

## Request identity

```
request.user.id  // from wa_session → Session → User
request.user.role
```

**Never** accept `userId` or `role=OWNER` from client body to escalate privileges.

## Last OWNER protection

Backend rejects demotion / deactivation of the last active OWNER (`LAST_OWNER_PROTECTED`).
Assigning OWNER via public APIs is forbidden (`OWNER_ASSIGN_FORBIDDEN`).
