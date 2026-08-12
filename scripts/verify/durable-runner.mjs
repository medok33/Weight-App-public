#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

export function runDurable(command, args, { cwd = process.cwd(), env = process.env, resultPath, stdoutPath, stderrPath } = {}) {
  if (!resultPath || !stdoutPath || !stderrPath) throw new Error('DURABLE_RUNNER_PATHS_REQUIRED');
  const startedAt = new Date().toISOString();
  atomicWrite(resultPath, { state: 'RUNNING', pid: null, startedAt, command, args });
  mkdirSync(dirname(stdoutPath), { recursive: true });
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  atomicWrite(resultPath, { state: 'RUNNING', pid: child.pid, startedAt, command, args, stdoutPath, stderrPath });
  const out = createWriteStream(stdoutPath, { flags: 'a' });
  const err = createWriteStream(stderrPath, { flags: 'a' });
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  return new Promise((resolvePromise) => {
    child.once('error', (error) => {
      const finishedAt = new Date().toISOString();
      const result = { state: 'INFRA_FAILURE', pid: child.pid, startedAt, finishedAt, exitCode: 1, signal: null, error: String(error.message), command, args, stdoutPath, stderrPath };
      atomicWrite(resultPath, result);
      resolvePromise(result);
    });
    child.once('close', (exitCode, signal) => {
      const finishedAt = new Date().toISOString();
      const result = { state: exitCode === 0 ? 'PASS' : 'FAIL', pid: child.pid, startedAt, finishedAt, exitCode: exitCode ?? 1, signal: signal ?? null, command, args, stdoutPath, stderrPath };
      atomicWrite(resultPath, result);
      resolvePromise(result);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const directory = process.env.DURABLE_RUNNER_DIR ?? resolve(process.cwd(), '.data/verification');
  const result = await runDurable(command, args, {
    cwd: process.cwd(),
    resultPath: resolve(directory, 'durable-runner.result.json'),
    stdoutPath: resolve(directory, 'durable-runner.stdout.log'),
    stderrPath: resolve(directory, 'durable-runner.stderr.log'),
  });
  process.exit(result.exitCode ?? 1);
}
