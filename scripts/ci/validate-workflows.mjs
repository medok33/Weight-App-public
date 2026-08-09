#!/usr/bin/env node
/* eslint-env node */
/**
 * Local validation for DEPLOY-01D workflow contracts (no network required).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflowsDir = resolve(root, '.github/workflows');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const workflowNames = new Set();
const jobNames = new Set();

for (const file of files) {
  const text = readFileSync(resolve(workflowsDir, file), 'utf8');
  const nameMatch = text.match(/^name:\s*(.+)$/m);
  if (!nameMatch) fail(`${file}: missing workflow name`);
  const wfName = nameMatch[1].trim();
  if (workflowNames.has(wfName)) fail(`Duplicate workflow name: ${wfName}`);
  workflowNames.add(wfName);

  if (/pull_request_target/.test(text)) fail(`${file}: pull_request_target is forbidden`);
  if (/OWNER_BOOTSTRAP_PASSWORD|VPS_|SSH_PRIVATE|GH_PAT|github_pat_/.test(text)) {
    fail(`${file}: forbidden credential pattern`);
  }

  for (const m of text.matchAll(/^\s{2}([A-Za-z0-9_-]+):\s*$/gm)) {
    // rough job id collection under jobs: — validated separately below
    void m;
  }

  const jobsBlock = text.split(/^jobs:\s*$/m)[1] || '';
  for (const jm of jobsBlock.matchAll(/^\s{2}([A-Za-z0-9_-]+):\s*$/gm)) {
    const jobId = jm[1];
    if (jobNames.has(jobId)) fail(`Duplicate job id across workflows: ${jobId}`);
    jobNames.add(jobId);
  }

  for (const line of text.split('\n')) {
    if (!line.includes('uses:')) continue;
    const trimmed = line.trim().replace(/^-\s*/, '');
    if (trimmed.startsWith('#')) continue;
    if (/uses:\s*\./.test(trimmed)) continue;
    if (!trimmed.startsWith('uses:')) continue;
    const ref = trimmed.replace(/^uses:\s*/, '').split(/\s+#/)[0].trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(ref)) {
      fail(`${file}: action must be pinned to full commit SHA: ${trimmed}`);
    }
  }

  if (file === 'ci.yml') {
    if (!/permissions:\s*\n\s*contents:\s*read/.test(text)) fail('ci.yml must default to contents:read');
    if (/packages:\s*write/.test(text)) fail('ci.yml must not grant packages:write');
    if (/docker push|push:\s*true/.test(text)) fail('ci.yml must not push images');
    if (!/ci-user-runtime-smoke:/.test(text) || !/test:e2e:runtime-smoke/.test(text)) {
      fail('ci.yml must run CI USER Runtime Smoke via test:e2e:runtime-smoke');
    }
  }

  if (file === 'release-images.yml') {
    if (/pull_request:/.test(text)) fail('release-images.yml must not run on pull_request');
    if (!/packages:\s*write/.test(text)) fail('release-images.yml publish job needs packages:write');
    if (!/ghcr\.io\/medok33\/weight-app-(web|api|worker|migrate)/.test(text)) {
      fail('release-images.yml must use lowercase GHCR package names');
    }
    if (/type=raw,value=latest|:latest\b/.test(text)) fail('release-images.yml must not use latest as identity');
  }
}

console.info(JSON.stringify({ ok: true, workflows: [...workflowNames], jobs: [...jobNames] }, null, 2));
