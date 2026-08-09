import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const SECRET_KEY = /(?:SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL|REDIS_URL|ENCRYPTION_KEY)/i;

export const RESULT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  TIMEOUT: 'TIMEOUT',
  SKIPPED: 'SKIPPED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

export function redactText(value, env = process.env) {
  let text = String(value ?? '');
  text = text.replace(/\b(postgresql?|redis):\/\/[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1://<redacted>@');
  for (const [key, secret] of Object.entries(env)) {
    if (!SECRET_KEY.test(key) || !secret || String(secret).length < 4) continue;
    text = text.split(String(secret)).join('<redacted>');
  }
  return text;
}

export function commandText(command, args = []) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

export function createInventory({ gitSha, runtimeId, runId = `platform-01-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`, startedAt = new Date().toISOString() }) {
  return {
    runId,
    gitSha,
    runtimeId,
    startedAt,
    finishedAt: null,
    totalElapsedMs: null,
    stages: [],
    cleanupResult: null,
  };
}

export function addInventoryStage(inventory, stage) {
  inventory.stages.push({
    name: stage.name,
    executed: stage.executed,
    result: stage.result,
    startedAt: stage.startedAt ?? null,
    finishedAt: stage.finishedAt ?? null,
    elapsedMs: stage.elapsedMs ?? 0,
    timeoutMs: stage.timeoutMs ?? null,
    command: stage.command ?? null,
    exitCode: stage.exitCode ?? null,
    reason: stage.reason ?? null,
    lastProgress: stage.lastProgress ?? null,
  });
  return inventory.stages.at(-1);
}

export function finalizeInventory(inventory, cleanupResult, finishedAt = new Date().toISOString()) {
  inventory.finishedAt = finishedAt;
  inventory.totalElapsedMs = Math.max(0, Date.parse(finishedAt) - Date.parse(inventory.startedAt));
  inventory.cleanupResult = cleanupResult;
  return inventory;
}

export function resolvePnpmInvocation(env = process.env) {
  const execPath = env.npm_execpath;
  if (execPath && existsSync(execPath)) return { command: process.execPath, argsPrefix: [execPath] };
  if (process.platform === 'win32') {
    const pnpmCmd = spawnSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8', windowsHide: true }).stdout?.split(/\r?\n/).find(Boolean);
    if (!pnpmCmd) throw new Error('PNPM_EXECUTABLE_NOT_FOUND');
    return { command: process.execPath, argsPrefix: [resolve(dirname(pnpmCmd), 'node_modules/pnpm/bin/pnpm.mjs')] };
  }
  return { command: 'pnpm', argsPrefix: [] };
}

export function terminateProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-pid, 'SIGTERM'); } catch { /* process already exited */ }
}

export function runBoundedProcess(command, args, {
  cwd,
  env = process.env,
  timeoutMs,
  label = command,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`INVALID_STAGE_TIMEOUT:${label}`);
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let lastProgress = null;
    const progressLines = [];
    let timedOut = false;
    let settled = false;
    const collect = (chunk, target, stream) => {
      const redacted = redactText(chunk, env);
      if (target === 'stdout') stdout += redacted;
      else stderr += redacted;
      const lines = redacted.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length) {
        lastProgress = lines.at(-1).slice(0, 1000);
        progressLines.push(...lines.map((line) => line.slice(0, 1000)));
        if (progressLines.length > 24) progressLines.splice(0, progressLines.length - 24);
      }
      stream?.write(redacted);
    };
    child.stdout?.on('data', (chunk) => collect(chunk, 'stdout', output));
    child.stderr?.on('data', (chunk) => collect(chunk, 'stderr', errorOutput));
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      lastProgress = lastProgress ?? `${label} exceeded ${timeoutMs}ms`;
      terminateProcessTree(child.pid);
      try { child.kill('SIGKILL'); } catch { /* process already exited */ }
    }, timeoutMs);
    child.on('error', (error) => {
      stderr += redactText(error.message, env);
      lastProgress = redactText(error.message, env);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolvePromise({
        command: commandText(command, args),
        exitCode: timedOut ? 124 : (code ?? 1),
        signal: signal ?? null,
        timedOut,
        elapsedMs: Date.now() - started,
        stdout,
        stderr,
        lastProgress,
        progressTail: progressLines.join('\n'),
      });
    });
  });
}

export async function runStage({
  inventory,
  name,
  timeoutMs = null,
  command = null,
  applicable = true,
  notApplicableReason = null,
  action,
  env = process.env,
  output = process.stdout,
}) {
  if (!applicable) {
    const stage = addInventoryStage(inventory, {
      name,
      executed: false,
      result: RESULT.NOT_APPLICABLE,
      command,
      reason: notApplicableReason ?? 'not applicable',
    });
    output.write(`VERIFY_STAGE_END ${JSON.stringify(stage)}\n`);
    return stage;
  }
  const startedAt = new Date().toISOString();
  output.write(`VERIFY_STAGE_START ${JSON.stringify({ name, startedAt, timeoutMs, command })}\n`);
  const started = Date.now();
  let outcome;
  try {
    outcome = await action();
  } catch (error) {
    outcome = {
      exitCode: Number.isInteger(error?.exitCode) ? error.exitCode : 1,
      timedOut: Boolean(error?.timedOut),
      reason: redactText(error instanceof Error ? error.message : error, env),
      lastProgress: redactText(error?.lastProgress ?? error?.message ?? error, env),
    };
  }
  const result = outcome?.timedOut
    ? RESULT.TIMEOUT
    : outcome && outcome.exitCode === 0
      ? RESULT.PASS
      : RESULT.FAIL;
  const stage = addInventoryStage(inventory, {
    name,
    executed: true,
    result,
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    timeoutMs,
    command,
    exitCode: outcome?.timedOut ? 124 : (outcome?.exitCode ?? 1),
    reason: redactText(outcome?.reason ?? (outcome ? null : 'stage returned no outcome'), env),
    lastProgress: redactText(outcome?.lastProgress ?? null, env),
  });
  output.write(`VERIFY_STAGE_END ${JSON.stringify(stage)}\n`);
  if (result !== RESULT.PASS) {
    const error = new Error(`VERIFY_STAGE_${result}:${name}`);
    error.exitCode = stage.exitCode;
    error.timedOut = result === RESULT.TIMEOUT;
    error.lastProgress = stage.lastProgress;
    throw error;
  }
  return stage;
}

export async function runStagePlan({ stages, inventory, cleanup, output = process.stdout }) {
  let failure = null;
  let nextStageIndex = 0;
  try {
    for (; nextStageIndex < stages.length; nextStageIndex += 1) {
      await runStage({ ...stages[nextStageIndex], inventory, output });
    }
  } catch (error) {
    failure = error;
    for (const stage of stages.slice(nextStageIndex + 1)) {
      const skipped = addInventoryStage(inventory, {
        name: stage.name,
        executed: false,
        result: RESULT.SKIPPED,
        timeoutMs: stage.timeoutMs ?? null,
        command: stage.command ?? null,
        reason: `blocked by ${stages[nextStageIndex]?.name ?? 'earlier stage'}`,
      });
      output.write(`VERIFY_STAGE_END ${JSON.stringify(skipped)}\n`);
    }
  } finally {
    let cleanupResult;
    try {
      cleanupResult = await cleanup();
      if (cleanupResult?.result !== RESULT.PASS) {
        const cleanupError = new Error(`VERIFY_CLEANUP_${cleanupResult?.result ?? RESULT.FAIL}`);
        cleanupError.exitCode = cleanupResult?.exitCode ?? 1;
        cleanupError.timedOut = cleanupResult?.result === RESULT.TIMEOUT;
        failure ??= cleanupError;
      }
    } catch (error) {
      cleanupResult = { result: RESULT.FAIL, reason: redactText(error instanceof Error ? error.message : error) };
      failure ??= error;
    }
    finalizeInventory(inventory, cleanupResult);
  }
  if (failure) throw failure;
  return inventory;
}
