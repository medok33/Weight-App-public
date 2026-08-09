# Prisma conventions

Migrations are append-only and reviewed before production. UUID primary keys,
UTC timestamps, explicit indexes, unique provider identities, hashed session
tokens, and foreign-key ownership are required. Application code uses a
repository/service boundary and never constructs raw SQL from request input.
