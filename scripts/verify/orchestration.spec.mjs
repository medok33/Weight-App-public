import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  RESULT,
  addInventoryStage,
  createInventory,
  finalizeInventory,
  redactText,
  runBoundedProcess,
  runStagePlan,
} from './orchestration.mjs';
import { classifyMarkerValue } from './disposable-runtime.mjs';

const silent = { write() {} };
const inventory = () => createInventory({ gitSha: 'abc123', runtimeId: 'wa-test-12345678' });
const nodeStage = (name, source, timeoutMs) => ({
  name,
  timeoutMs,
  command: `node -e ${JSON.stringify(source)}`,
  action: () => runBoundedProcess(process.execPath, ['-e', source], { timeoutMs, output: silent, errorOutput: silent }),
});

test('A: a passing stage advances to the next stage', async () => {
  const seen = [];
  const result = await runStagePlan({
    inventory: inventory(),
    output: silent,
    stages: [
      { name: 'first', timeoutMs: 100, command: 'fixture:first', action: async () => { seen.push('first'); return { exitCode: 0 }; } },
      { name: 'second', timeoutMs: 100, command: 'fixture:second', action: async () => { seen.push('second'); return { exitCode: 0 }; } },
    ],
    cleanup: async () => ({ result: RESULT.PASS }),
  });
  assert.deepEqual(seen, ['first', 'second']);
  assert.deepEqual(result.stages.map((stage) => stage.result), [RESULT.PASS, RESULT.PASS]);
});

test('B: non-zero stage fails the run and cleanup still executes', async () => {
  let cleaned = false;
  const runInventory = inventory();
  await assert.rejects(() => runStagePlan({
    inventory: runInventory,
    output: silent,
    stages: [nodeStage('failure', 'process.exit(7)', 1000)],
    cleanup: async () => { cleaned = true; return { result: RESULT.PASS }; },
  }), /VERIFY_STAGE_FAIL:failure/);
  assert.equal(cleaned, true);
  assert.equal(runInventory.stages[0].exitCode, 7);
  assert.equal(runInventory.cleanupResult.result, RESULT.PASS);
});

test('C: stage timeout reports the exact stage and cleanup executes', async () => {
  let cleaned = false;
  const runInventory = inventory();
  const descendantMarker = resolve(tmpdir(), `platform-01-descendant-${process.pid}-${Date.now()}.txt`);
  const descendantSource = `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(descendantMarker)},'orphan'),800)`) }],{stdio:'ignore'}); setTimeout(()=>{},5000)`;
  await assert.rejects(() => runStagePlan({
    inventory: runInventory,
    output: silent,
    stages: [nodeStage('slow-stage', descendantSource, 100)],
    cleanup: async () => { cleaned = true; return { result: RESULT.PASS }; },
  }), /VERIFY_STAGE_TIMEOUT:slow-stage/);
  await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 1000));
  assert.equal(cleaned, true);
  assert.equal(runInventory.stages[0].result, RESULT.TIMEOUT);
  assert.equal(runInventory.stages[0].exitCode, 124);
  assert.equal(existsSync(descendantMarker), false, 'timed-out descendants must not survive the stage owner');
  rmSync(descendantMarker, { force: true });
});

test('D: a stage near its finite bound is not killed by an outer orchestrator', async () => {
  const result = await runStagePlan({
    inventory: inventory(),
    output: silent,
    stages: [nodeStage('near-bound', 'setTimeout(() => process.exit(0), 120)', 500)],
    cleanup: async () => ({ result: RESULT.PASS }),
  });
  assert.equal(result.stages[0].result, RESULT.PASS);
  assert.ok(result.stages[0].elapsedMs >= 100);
});

test('E: marker identity mismatch fails immediately and is never classified transient', () => {
  assert.throws(() => classifyMarkerValue('wa-wrong-12345678', 'wa-test-12345678', 'POSTGRES_SERVER_MARKER'), /IDENTITY_MISMATCH/);
});

test('F: secret-like values and URL credentials are redacted', () => {
  const env = { DATABASE_URL: 'postgresql://user:db-secret@127.0.0.1:5432/db', AUTH_SESSION_SECRET: 'session-secret-value' };
  const text = redactText(`url=${env.DATABASE_URL} secret=${env.AUTH_SESSION_SECRET}`, env);
  assert.doesNotMatch(text, /db-secret|session-secret-value/);
  assert.match(text, /<redacted>/);
});

test('G: inventory preserves PASS FAIL TIMEOUT SKIPPED and NOT_APPLICABLE distinctly', () => {
  const runInventory = inventory();
  for (const result of [RESULT.PASS, RESULT.FAIL, RESULT.TIMEOUT, RESULT.SKIPPED, RESULT.NOT_APPLICABLE]) {
    addInventoryStage(runInventory, { name: result.toLowerCase(), executed: ![RESULT.SKIPPED, RESULT.NOT_APPLICABLE].includes(result), result });
  }
  finalizeInventory(runInventory, { result: RESULT.PASS });
  assert.deepEqual(runInventory.stages.map((stage) => stage.result), [RESULT.PASS, RESULT.FAIL, RESULT.TIMEOUT, RESULT.SKIPPED, RESULT.NOT_APPLICABLE]);
  assert.equal(runInventory.cleanupResult.result, RESULT.PASS);
});

test('a stage cannot pass without an explicit successful outcome', async () => {
  const runInventory = inventory();
  await assert.rejects(() => runStagePlan({
    inventory: runInventory,
    output: silent,
    stages: [{ name: 'missing outcome', action: async () => undefined }],
    cleanup: async () => ({ result: RESULT.PASS }),
  }), /VERIFY_STAGE_FAIL:missing outcome/);
  assert.equal(runInventory.stages[0].result, RESULT.FAIL);
  assert.equal(runInventory.stages[0].reason, 'stage returned no outcome');
});

test('cleanup failure makes an otherwise passing run fail', async () => {
  const runInventory = inventory();
  await assert.rejects(() => runStagePlan({
    inventory: runInventory,
    output: silent,
    stages: [{ name: 'pass', action: async () => ({ exitCode: 0 }) }],
    cleanup: async () => ({ result: RESULT.FAIL, exitCode: 9, reason: 'owned resources remain' }),
  }), /VERIFY_CLEANUP_FAIL/);
  assert.equal(runInventory.cleanupResult.result, RESULT.FAIL);
});
