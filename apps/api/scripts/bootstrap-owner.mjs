/**
 * Public snapshot guard. Owner bootstrap is intentionally unavailable in the
 * public repository; this file exists to make the boundary explicit and to
 * prevent accidental hardcoded credentials in public CI.
 */
const requiredNames = [
  'OWNER_BOOTSTRAP_USERNAME',
  'OWNER_BOOTSTRAP_PASSWORD',
  'OWNER_BOOTSTRAP_FORCE_PASSWORD',
  'DATABASE_URL',
];

if (process.env.PUBLIC_REPOSITORY === 'true') {
  console.error('Owner bootstrap is disabled in the public repository.');
  process.exitCode = 1;
} else {
  console.error(`Owner bootstrap is not included in this public snapshot: ${requiredNames.join(', ')}`);
  process.exitCode = 1;
}
