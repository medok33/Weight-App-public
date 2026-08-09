-- Local-only bootstrap. Application migrations own all domain tables.
SET TIME ZONE 'UTC';

CREATE EXTENSION IF NOT EXISTS pgcrypto;
