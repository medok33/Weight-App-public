#!/usr/bin/env node
/**
 * Public CI-only Docker build helper. Builds local verification images; never pushes,
 * deploys, reads application credentials, or uses a private environment.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const release = (process.env.RELEASE_VERSION || '0.0.0-ci').trim();
const gitSha = (process.env.GIT_SHA || 'unknown').trim();
const buildTimestamp = (process.env.BUILD_TIMESTAMP || new Date().toISOString()).trim();
const ociSource = (process.env.OCI_SOURCE || 'https://github.com/medok33/Weight-App-public').trim();
const shortSha = gitSha === 'unknown' ? 'unknown' : gitSha.slice(0, 7);
const common = ['--build-arg', `RELEASE_VERSION=${release}`, '--build-arg', `GIT_SHA=${gitSha}`, '--build-arg', `BUILD_TIMESTAMP=${buildTimestamp}`, '--build-arg', `OCI_SOURCE=${ociSource}`];

function run(args) {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const builds = [
  ['docker/Dockerfile.web', [], 'weight-app-web'],
  ['docker/Dockerfile.api', ['--target', 'api'], 'weight-app-api'],
  ['docker/Dockerfile.api', ['--target', 'migrate'], 'weight-app-migrate'],
  ['docker/Dockerfile.worker', [], 'weight-app-worker'],
];

for (const [file, extra, image] of builds) {
  run(['build', ...common, ...extra, '-f', file, '-t', `${image}:${release}-${shortSha}`, '-t', `${image}:local`, '.']);
}

console.info(JSON.stringify({ event: 'public-ci-build.done', release, gitSha, buildTimestamp, images: builds.map(([, , image]) => `${image}:local`) }, null, 2));
