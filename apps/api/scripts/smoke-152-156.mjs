/* eslint-env node */
import pg from 'pg';
import { Buffer } from 'node:buffer';
import {
  decryptBackupPayload,
  deriveBackupKey,
  encryptBackupPayload,
  validateRestoreProcedure,
} from '../src/modules/audit-security/domain/audit-security.policy.ts';

const key = deriveBackupKey('local-dev-backup-secret');
const envelope = encryptBackupPayload(Buffer.from(JSON.stringify({ ok: true }), 'utf8'), key);
const plain = decryptBackupPayload(envelope, key).toString('utf8');
const plan = validateRestoreProcedure({
  backupId: 'b1',
  storageKey: 'b1.enc.json',
  environment: 'isolated',
  dryRun: true,
  confirmedByOwner: true,
  confirmation: 'RESTORE',
});

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://weight_app:weight_app_local@localhost:5432/weight_app',
});
await client.connect();
const tables = await client.query(
  `SELECT to_regclass('"AlertRule"') AS alert, to_regclass('"OwnerNotification"') AS note, to_regclass('"BackupJob"') AS backup`,
);
await client.end();

console.info(
  JSON.stringify({
    plain,
    executable: plan.executable,
    tables: tables.rows[0],
  }),
);
