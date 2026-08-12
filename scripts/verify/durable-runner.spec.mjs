import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runDurable } from './durable-runner.mjs';

const node = process.execPath;
const script = 'console.log("runner-child"); setTimeout(() => process.exit(Number(process.argv[1])), 20)';

async function run(code, exit = 0) {
  const dir = mkdtempSync(resolve(tmpdir(), 'price-durable-runner-'));
  try {
    return await runDurable(node, ['-e', code, String(exit)], {
      resultPath: resolve(dir, 'result.json'), stdoutPath: resolve(dir, 'stdout.log'), stderrPath: resolve(dir, 'stderr.log'),
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('durable runner captures zero exit', async () => assert.equal((await run(script, 0)).state, 'PASS'));
test('durable runner captures nonzero exit', async () => assert.equal((await run(script, 7)).exitCode, 7));
test('durable runner captures delayed child exit', async () => assert.equal((await run(script, 0)).state, 'PASS'));
test('durable runner persists atomic terminal result', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'price-durable-runner-'));
  try {
    const resultPath = resolve(dir, 'result.json');
    const result = await runDurable(node, ['-e', 'process.exit(3)'], { resultPath, stdoutPath: resolve(dir, 'o.log'), stderrPath: resolve(dir, 'e.log') });
    assert.equal(JSON.parse(readFileSync(resultPath, 'utf8')).exitCode, result.exitCode);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('durable runner records abnormal child termination', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'price-durable-runner-'));
  try {
    const resultPath = resolve(dir, 'result.json');
    const result = await runDurable(node, ['-e', 'process.kill(process.pid, "SIGTERM")'], { resultPath, stdoutPath: resolve(dir, 'o.log'), stderrPath: resolve(dir, 'e.log') });
    assert.equal(result.state, 'FAIL');
    assert.equal(result.exitCode, 1);
    assert.ok(result.signal || result.exitCode !== 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
