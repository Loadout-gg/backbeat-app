const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const config = {
  BACKBEAT_ENV: 'development',
  NEXT_PUBLIC_BACKBEAT_ENV: 'development',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55322',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key',
  SUPABASE_LINK_ANON_KEY: 'synthetic-public-key',
  SUPABASE_INTERNAL_URL: 'http://kong:8000',
};

function transport() {
  return require('../../ops/local/start.cjs');
}

test('launcher refuses to start Next without an isolated environment', () => {
  const { spawnSync } = require('node:child_process');
  const { resolve } = require('node:path');
  const result = spawnSync(process.execPath, [resolve(__dirname, '../../ops/local/start.cjs')], {
    env: {}, encoding: 'utf8', timeout: 2000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid isolated development configuration/);
});

test('accepts only the explicit isolated development configuration', () => {
  const { validateConfig } = transport();
  assert.deepEqual(validateConfig(config), { host: 'kong', port: 8000 });
  for (const patch of [
    { BACKBEAT_ENV: undefined },
    { NEXT_PUBLIC_BACKBEAT_ENV: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://unapproved.example.test' },
    { SUPABASE_INTERNAL_URL: 'http://unapproved:8000' },
    { SUPABASE_LINK_ANON_KEY: 'different-key' },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: '', SUPABASE_LINK_ANON_KEY: '' },
  ]) {
    assert.throws(() => validateConfig({ ...config, ...patch }), /Invalid isolated development configuration/);
  }
});

test('forwards traffic to the designated upstream and releases its sockets', async () => {
  const { createLoopbackProxy } = transport();
  const upstream = net.createServer(socket => socket.pipe(socket));
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const proxy = createLoopbackProxy({ host: '127.0.0.1', port: upstream.address().port });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const client = net.createConnection({ host: '127.0.0.1', port: proxy.address().port });
      client.setTimeout(2000, () => client.destroy(new Error('transport timeout')));
      client.on('error', reject);
      client.on('data', data => { resolve(data.toString()); client.end(); });
      client.on('connect', () => client.write('local-development-only'));
    });
    assert.equal(result, 'local-development-only');
  } finally {
    await proxy.shutdown();
    await new Promise(resolve => upstream.close(resolve));
  }
});
