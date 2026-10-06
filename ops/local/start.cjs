const net = require('node:net');

function validateConfig(env) {
  if (
    env.BACKBEAT_ENV !== 'development' ||
    env.NEXT_PUBLIC_BACKBEAT_ENV !== 'development' ||
    env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:55322' ||
    env.SUPABASE_INTERNAL_URL !== 'http://kong:8000' ||
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_LINK_ANON_KEY !== env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) throw new Error('Invalid isolated development configuration');
  return { host: 'kong', port: 8000 };
}

function createLoopbackProxy({ host, port }) {
  const sockets = new Set();
  const server = net.createServer(client => {
    const upstream = net.createConnection({ host, port });
    sockets.add(client);
    sockets.add(upstream);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => { sockets.delete(client); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
    client.pipe(upstream);
    upstream.pipe(client);
  });
  server.shutdown = () => new Promise(resolve => {
    for (const socket of sockets) socket.destroy();
    server.close(resolve);
  });
  return server;
}

if (require.main === module) {
  let target;
  try {
    target = validateConfig(process.env);
  } catch {
    console.error('Invalid isolated development configuration');
    process.exit(1);
  }
  const { spawn } = require('node:child_process');
  const proxy = createLoopbackProxy(target);
  let child;
  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    if (child && child.exitCode === null) child.kill(signal);
    void proxy.shutdown();
  };
  proxy.on('error', error => {
    console.error('Local transport failed:', error.code || 'unknown');
    process.exitCode = 1;
    stop('SIGTERM');
  });
  proxy.listen(55322, '127.0.0.1', () => {
    child = spawn(process.execPath, [
      'node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', '3101',
    ], { stdio: 'inherit' });
    child.on('error', () => { process.exitCode = 1; stop('SIGTERM'); });
    child.on('exit', code => {
      if (code !== null) process.exitCode = code;
      void proxy.shutdown();
    });
  });
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

module.exports = { validateConfig, createLoopbackProxy };
