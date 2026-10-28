const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { setTimeout: pause } = require('node:timers/promises')

test('built Next starts, serves public SSR, redirects anonymous users and reports its runtime',
  { timeout: 60000 }, async t => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1')
    await once(probe, 'listening')
    const port = probe.address().port
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
    const started = performance.now()
    const child = spawn(process.execPath, [
      'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port),
    ], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let startupError
    const exited = new Promise(resolve => {
      child.once('exit', (code, signal) => resolve({ code, signal }))
      child.once('error', error => { startupError = error; resolve({ error }) })
    })
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null && !startupError) {
        child.kill('SIGTERM')
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
        timer.unref()
        await exited
        clearTimeout(timer)
      }
    })
    while (!output.includes('Ready')) {
      assert.equal(startupError, undefined)
      assert.equal(child.exitCode, null, output)
      assert.equal(child.signalCode, null, output)
      assert.ok(performance.now() - started < 30000, output)
      await pause(100)
    }
    const startupMs = performance.now() - started
    const origin = `http://127.0.0.1:${port}`
    for (const route of ['/auth/login', '/auth/signup', '/auth/signup-success', '/auth/signup-confirmation.html']) {
      const response = await fetch(origin + route, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
      assert.equal(response.status, 200, `${route}: ${output}`)
      assert.match(response.headers.get('content-type') || '', /text\/html/)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(response.headers.get('x-frame-options'), 'DENY')
      assert.ok((await response.text()).length > 0)
    }
    const anonymous = await fetch(origin + '/dashboard', { redirect: 'manual', signal: AbortSignal.timeout(10000) })
    assert.equal(anonymous.status, 307)
    assert.equal(new URL(anonymous.headers.get('location'), origin).pathname, '/auth/login')
    await anonymous.arrayBuffer()
    // Production instrumentation may initialize on the first request, after the Ready banner.
    assert.ok(output.includes(JSON.stringify({ event: 'backbeat.runtime', node: process.versions.node })), output)
    t.diagnostic(output)
    t.diagnostic(JSON.stringify({ node: process.versions.node, startupMs }))
  })
