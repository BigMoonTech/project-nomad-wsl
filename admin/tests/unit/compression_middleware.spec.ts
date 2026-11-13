import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http'
import { test } from 'node:test'
import zlib from 'node:zlib'
import axios from 'axios'

// Only validates Env; no Adonis application, database or installed services boot.
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '8080',
  APP_KEY: 'test-only-000000000000000000000000',
  HOST: '127.0.0.1',
  URL: 'http://localhost:8080',
  LOG_LEVEL: 'silent',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'test',
  DB_DATABASE: 'test',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  DISABLE_COMPRESSION: 'false',
})
const { default: CompressionMiddleware } =
  await import('../../app/middleware/compression_middleware.js')

async function withMiddleware(
  respond: (req: IncomingMessage, res: ServerResponse) => void,
  check: (url: string) => Promise<void>,
) {
  const middleware = new CompressionMiddleware()
  const server = createServer((req, res) => {
    const context = { request: { request: req }, response: { response: res } }
    middleware
      .handle(context as any, async () => respond(req, res))
      .catch((error) => res.destroy(error))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    await check(`http://127.0.0.1:${address.port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('normal compressed dashboard responses retain exact body bytes', async () => {
  const body = JSON.stringify({ fixture: 'NOMAD response '.repeat(512) })
  await withMiddleware(
    (_, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(body)
    },
    async (url) => {
      const response = await axios.get(url, {
        headers: { 'Accept-Encoding': 'gzip' },
        decompress: false,
        responseType: 'arraybuffer',
        proxy: false,
      })
      assert.equal(response.headers['content-encoding'], 'gzip')
      assert.equal(zlib.gunzipSync(response.data).toString(), body)
    },
  )
})

test('DISABLE_COMPRESSION still bypasses the compression middleware', () => {
  const moduleUrl = new URL('../../app/middleware/compression_middleware.js', import.meta.url).href
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    const { default: Middleware } = await import(${JSON.stringify(moduleUrl)})
    console.log(await new Middleware().handle({}, async () => 'bypassed'))
  `,
    ],
    { env: { ...process.env, DISABLE_COMPRESSION: 'true' }, timeout: 5000 },
  )
  assert.equal(output.toString().trim(), 'bypassed')
})

for (const [encoding, factory] of [
  ['gzip', 'createGzip'],
  ['deflate', 'createDeflate'],
  ['br', 'createBrotliCompress'],
] as const) {
  test(
    `aborted ${encoding} responses release the native compression stream`,
    { timeout: 5000 },
    async () => {
      const descriptor = Object.getOwnPropertyDescriptor(zlib, factory)!
      let stream: ReturnType<typeof zlib.createGzip> | undefined
      Object.defineProperty(zlib, factory, {
        ...descriptor,
        value: (...args: unknown[]) => {
          stream = descriptor.value(...args)
          return stream
        },
      })
      let closed!: () => void
      const responseClosed = new Promise<void>((resolve) => {
        closed = resolve
      })
      try {
        await withMiddleware(
          (_, res) => {
            res.once('close', closed)
            res.setHeader('Content-Type', 'text/plain')
            res.write('NOMAD response '.repeat(512))
            ;(res as ServerResponse & { flush(): void }).flush()
          },
          async (url) => {
            const request = get(url, { headers: { 'Accept-Encoding': encoding } }, (response) => {
              assert.equal(response.headers['content-encoding'], encoding)
              response.once('data', () => response.destroy())
            })
            request.on('error', () => {})
            await responseClosed
            assert.ok(stream)
            // The fix destroys synchronously on response close. A destroy event
            // also confirms native cleanup, without relying on process RSS or GC.
            assert.equal(stream.destroyed, true)
            if (!stream.closed) await once(stream, 'close')
          },
        )
      } finally {
        stream?.destroy()
        Object.defineProperty(zlib, factory, descriptor)
      }
    },
  )
}

test(
  'SSE delivers the first event before completion without compression',
  { timeout: 5000 },
  async () => {
    let finish!: () => void
    await withMiddleware(
      (_, res) => {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.write('data: first\n\n')
        finish = () => res.end('data: done\n\n')
      },
      async (url) => {
        const response = await fetch(url, {
          headers: { 'Accept-Encoding': 'gzip, br' },
          signal: AbortSignal.timeout(4000),
        })
        assert.equal(response.headers.get('content-encoding'), null)
        const reader = response.body!.getReader()
        const first = await reader.read()
        assert.equal(Buffer.from(first.value!).toString(), 'data: first\n\n')
        finish()
        let rest = ''
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          rest += Buffer.from(chunk.value).toString()
        }
        assert.equal(rest, 'data: done\n\n')
      },
    )
  },
)
