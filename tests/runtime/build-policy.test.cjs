const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

test('container install receives the explicit denied-build policy before dependency installation', () => {
  const dockerfile = readFileSync(resolve(__dirname, '../../ops/local/Dockerfile'), 'utf8');
  const policy = readFileSync(resolve(__dirname, '../../pnpm-workspace.yaml'), 'utf8');
  assert.match(policy, /^  sharp: false$/m);
  assert.match(policy, /^  unrs-resolver: false$/m);
  assert.doesNotMatch(policy, /^\s+[^#\n]+:\s*true\s*$/m);
  const beforeInstall = dockerfile.split('RUN pnpm install --frozen-lockfile --ignore-scripts')[0];
  assert.match(beforeInstall, /^COPY .*pnpm-workspace\.yaml .*\.\/$/m);
});

test('local development declares its calendar timezone before build and at runtime', () => {
  const dockerfile = readFileSync(resolve(__dirname, '../../ops/local/Dockerfile'), 'utf8');
  const beforeBuild = dockerfile.split('RUN pnpm run build')[0];
  assert.match(beforeBuild, /^ENV BACKBEAT_CALENDAR_TIME_ZONE=Europe\/Rome$/m);
});
