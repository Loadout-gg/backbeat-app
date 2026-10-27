const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')

// Synthetic loopback only. This does not qualify a hosted Supabase endpoint.
test('native fetch preserves cookies, redirects, UTF-8 JSON and cancellation', { timeout: 10000 }, async t => {
  const server = http.createServer((request, response) => {
    response.setHeader('connection', 'close')
    if (request.url === '/redirect') {
      response.writeHead(307, {
        location: '/payload',
        'set-cookie': [
          'first=synthetic; Path=/; HttpOnly',
          'second=synthetic; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/',
        ],
      })
      return response.end()
    }
    if (request.url === '/payload') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      return response.end(JSON.stringify({ name: 'Álpha 日本', fee: 0, empty: null }))
    }
    response.writeHead(404)
    response.end()
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const redirect = await fetch(`${origin}/redirect`, {
    redirect: 'manual', signal: AbortSignal.timeout(2000),
  })
  assert.equal(redirect.status, 307)
  assert.equal(redirect.headers.get('location'), '/payload')
  assert.deepEqual(redirect.headers.getSetCookie(), [
    'first=synthetic; Path=/; HttpOnly',
    'second=synthetic; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/',
  ])
  await redirect.arrayBuffer()
  const payload = await fetch(`${origin}/payload`, { signal: AbortSignal.timeout(2000) })
  assert.equal(payload.status, 200)
  assert.deepEqual(await payload.json(), { name: 'Álpha 日本', fee: 0, empty: null })
  await assert.rejects(fetch(`${origin}/redirect`, {
    redirect: 'error', signal: AbortSignal.timeout(2000),
  }), TypeError)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetch(`${origin}/payload`, { signal: controller.signal }),
    error => error.name === 'AbortError')
})

test('native WebCrypto preserves the synthetic HMAC contract', async () => {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode('backbeat-synthetic-key'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  )
  const message = encoder.encode('node-upgrade-fixture')
  const signature = await crypto.subtle.sign('HMAC', key, message)
  assert.equal(Buffer.from(signature).toString('hex'),
    'ce70681c10388065b37f49da421063ee06899c2866f57781ca4fcc9f27431186')
  assert.equal(await crypto.subtle.verify('HMAC', key, signature, message), true)
  assert.equal(await crypto.subtle.verify('HMAC', key, signature, encoder.encode('different')), false)
})
