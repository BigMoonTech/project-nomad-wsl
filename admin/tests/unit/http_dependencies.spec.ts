import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type RequestListener } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import axios from 'axios'
import { doResumableDownload, GatedContentAuthError } from '../../app/utils/downloads.js'

const require = createRequire(import.meta.url)

// A parent watchdog can interrupt synchronous parser regressions. Axios's own
// request timeout cannot interrupt a blocked event loop. No external requests.
async function boundedRequest(url: string, proxy = false) {
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads')
    const axios = require(workerData.axiosPath)
    for (const key of Object.keys(process.env)) {
      if (key.toLowerCase().endsWith('_proxy')) delete process.env[key]
    }
    if (workerData.proxy) {
      process.env.HTTP_PROXY = 'http://127.0.0.1:1'
      process.env.NO_PROXY = 'localhost'
    }
    parentPort.postMessage('ready')
    parentPort.once('message', async () => {
      try {
        const response = await axios.get(workerData.url, {
          timeout: 100, responseType: 'text', ...(workerData.proxy ? {} : { proxy: false })
        })
        parentPort.postMessage({ data: response.data })
      } catch (error) { parentPort.postMessage({ code: error.code }) }
    })
  `,
    { eval: true, workerData: { axiosPath: require.resolve('axios'), url, proxy } },
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await once(worker, 'message')
    const result = once(worker, 'message')
    worker.postMessage('start')
    return await Promise.race([
      result.then(([value]) => value),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('HTTP parser blocked beyond 2 seconds')), 2000)
      }),
    ])
  } finally {
    clearTimeout(timer)
    await worker.terminate()
  }
}

test(
  'malformed data URLs, including a remote-model API suffix, reject promptly',
  { timeout: 15000 },
  async () => {
    for (const url of [
      'data:' + '/'.repeat(100000) + '/api/tags',
      'data:text/' + '/'.repeat(100000),
    ]) {
      assert.equal((await boundedRequest(url)).code, 'ERR_BAD_REQUEST')
    }
    assert.equal(
      (await boundedRequest('data:text/plain;charset=utf-8;base64,bm9tYWQvZml4dHVyZQ==')).data,
      'nomad/fixture',
    )
  },
)

test('proxy hostname normalization cannot block the worker', { timeout: 10000 }, async () => {
  assert.ok((await boundedRequest('http://' + '.'.repeat(100000) + 'a/', true)).code)
})

async function withServer(
  handler: RequestListener,
  run: (url: string) => Promise<void>,
  host = '127.0.0.1',
) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, host, resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    await run(`http://${host}:${address.port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function withDownload(run: (file: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'nomad-http-test-'))
  try {
    await run(join(dir, 'fixture.pmtiles'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const bytes = Buffer.from('NOMAD download fixture with exact resumed bytes')
function fileHeaders(res: Parameters<RequestListener>[1]) {
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Length', bytes.length)
  res.setHeader('Accept-Ranges', 'bytes')
}

test('real same-origin redirects preserve credentials and resume downloads byte-for-byte', async () => {
  const calls: string[] = []
  await withServer(
    (req, res) => {
      assert.equal(req.headers.authorization, 'Bearer fixture')
      assert.match(req.headers['user-agent'] || '', /ProjectNOMAD/)
      calls.push(`${req.method} ${req.url}`)
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/file' })
        res.end()
        return
      }
      fileHeaders(res)
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      assert.equal(req.headers.range, 'bytes=7-')
      res.statusCode = 206
      res.setHeader('Content-Length', bytes.length - 7)
      res.setHeader('Content-Range', `bytes 7-${bytes.length - 1}/${bytes.length}`)
      res.end(bytes.subarray(7))
    },
    async (url) =>
      withDownload(async (filepath) => {
        await writeFile(filepath + '.tmp', bytes.subarray(0, 7))
        let completed = ''
        await doResumableDownload(
          {
            url: url + '/redirect',
            filepath,
            requestHeaders: { Authorization: 'Bearer fixture' },
            onComplete: async (source) => {
              completed = source
            },
          },
          axios.create({ proxy: false }),
        )
        assert.deepEqual(await readFile(filepath), bytes)
        assert.equal(completed, url + '/redirect')
        assert.deepEqual(calls, ['HEAD /redirect', 'HEAD /file', 'GET /redirect', 'GET /file'])
      }),
  )
})

test('cross-host redirects strip credentials while allowing ordinary downloads', async () => {
  let received = 0
  await withServer(
    (req, res) => {
      received++
      assert.equal(req.headers.authorization, undefined)
      assert.equal(req.headers.cookie, undefined)
      fileHeaders(res)
      res.end(req.method === 'HEAD' ? undefined : bytes)
    },
    async (destination) =>
      withServer(
        (req, res) => {
          assert.equal(req.headers.authorization, 'Bearer fixture')
          res.writeHead(302, { Location: destination + '/file' })
          res.end()
        },
        async (url) =>
          withDownload(async (filepath) => {
            await doResumableDownload(
              {
                url,
                filepath,
                requestHeaders: { Authorization: 'Bearer fixture', Cookie: 'test=private' },
              },
              axios.create({ proxy: false }),
            )
            assert.deepEqual(await readFile(filepath), bytes)
          }),
      ),
    '127.0.0.2',
  )
  assert.equal(received, 2)
})

test('a mirror ignoring Range restarts cleanly instead of appending duplicate bytes', async () => {
  const ranges: (string | undefined)[] = []
  await withServer(
    (req, res) => {
      fileHeaders(res)
      if (req.method !== 'HEAD') ranges.push(req.headers.range)
      res.end(req.method === 'HEAD' ? undefined : bytes)
    },
    async (url) =>
      withDownload(async (filepath) => {
        await writeFile(filepath + '.tmp', bytes.subarray(0, 7))
        await doResumableDownload({ url, filepath }, axios.create({ proxy: false }))
        assert.deepEqual(await readFile(filepath), bytes)
      }),
  )
  assert.deepEqual(ranges, ['bytes=7-', undefined])
})

test('gated-content failures retain their existing error contract', async () => {
  await withServer(
    (_, res) => {
      res.writeHead(403)
      res.end()
    },
    async (url) =>
      withDownload(async (filepath) => {
        await assert.rejects(
          doResumableDownload({ url, filepath }, axios.create({ proxy: false })),
          GatedContentAuthError,
        )
        await assert.rejects(stat(filepath), { code: 'ENOENT' })
      }),
  )
})

test(
  'cancelled downloads keep partial staging bytes without publishing a final file',
  { timeout: 10000 },
  async () => {
    await withServer(
      (req, res) => {
        fileHeaders(res)
        if (req.method === 'HEAD') res.end()
        else res.write(bytes.subarray(0, 7))
      },
      async (url) =>
        withDownload(async (filepath) => {
          const controller = new AbortController()
          const download = doResumableDownload(
            { url, filepath, signal: controller.signal },
            axios.create({ proxy: false }),
          )
          const rejected = assert.rejects(download, /abort|cancel/i)
          try {
            for (let attempt = 0; attempt < 100; attempt++) {
              if ((await stat(filepath + '.tmp').catch(() => null))?.size === 7) break
              await delay(10)
            }
            assert.equal((await stat(filepath + '.tmp')).size, 7)
          } finally {
            controller.abort()
          }
          await rejected
          await assert.rejects(stat(filepath), { code: 'ENOENT' })
        }),
    )
  },
)

test('fragmented model-pull NDJSON streams retain AbortSignal cancellation semantics', async () => {
  await withServer(
    (_, res) => {
      res.setHeader('Content-Type', 'application/x-ndjson')
      res.write('{"status":')
      setImmediate(() => res.write('"downloading"}\n'))
    },
    async (url) => {
      const controller = new AbortController()
      const response = await axios.post(
        url,
        { name: 'fixture', stream: true },
        {
          responseType: 'stream',
          signal: controller.signal,
          timeout: 0,
          proxy: false,
        },
      )
      let line = ''
      await assert.rejects(
        async () => {
          for await (const chunk of response.data) {
            line += chunk.toString()
            if (line.includes('\n')) controller.abort()
          }
        },
        (error: unknown) => axios.isCancel(error),
      )
      assert.equal(JSON.parse(line).status, 'downloading')
    },
  )
})

test('multipart field names and filenames cannot inject header lines', () => {
  const FormData = require('form-data')
  for (const injection of ['field"\r\nX-Injected: yes', 'field\nX-Injected: yes']) {
    const form = new FormData()
    form.append(injection, Buffer.from('fixture'), { filename: injection + '.txt' })
    const body = form.getBuffer().toString()
    assert.doesNotMatch(body, /[\r\n]X-Injected:/)
    assert.match(body, /fixture/)
  }
  const form = new FormData()
  form.append('files[0]', Buffer.from('fixture'), { filename: 'map notes.txt' })
  assert.match(form.getBuffer().toString(), /name="files\[0\]"; filename="map notes.txt"/)
})
