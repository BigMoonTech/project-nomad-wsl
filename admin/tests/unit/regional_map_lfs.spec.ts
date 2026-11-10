import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, test } from 'node:test'
import axios, { AxiosError } from 'axios'
import {
  downloadRegionalMap,
  regionalMapPointerAfterError,
} from '../../app/utils/regional_map_lfs.js'

const canonical =
  'https://github.com/Crosstalk-Solutions/project-nomad-maps/raw/refs/heads/master/pmtiles/ohio_2025-12.pmtiles'
const storage = 'https://github-cloud.githubusercontent.com/object?signature=fixture'
const bytes = Buffer.from('PMTiles map fixture')
const oid = createHash('sha256').update(bytes).digest('hex')
const originalAdapter = axios.defaults.adapter
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nomad-lfs-'))
})
afterEach(async () => {
  axios.defaults.adapter = originalAdapter
  await rm(dir, { recursive: true, force: true })
})

function source(options: { direct?: boolean; contents?: Buffer; href?: string } = {}) {
  const calls: string[] = []
  axios.defaults.adapter = async (config) => {
    const url = config.url!
    calls.push(url)
    const headers = {
      'content-length': String(bytes.length),
      'accept-ranges': 'bytes',
      'content-type': 'application/octet-stream',
    }
    let data
    if (url === canonical && !options.direct) throw new AxiosError('TLS handshake failed', 'EPROTO')
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      data = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`
    } else if (url.endsWith('/info/lfs/objects/batch')) {
      assert.deepEqual(JSON.parse(config.data).objects, [{ oid, size: bytes.length }])
      data = {
        objects: [
          { oid, size: bytes.length, actions: { download: { href: options.href ?? storage } } },
        ],
      }
    } else {
      assert.ok(url === canonical || url === storage)
      if (url === storage) assert.equal(config.maxRedirects, 0)
      if (config.method === 'get') {
        const offset = Number(String(config.headers.Range || '').match(/^bytes=(\d+)-$/)?.[1] || 0)
        data = Readable.from([(options.contents ?? bytes).subarray(offset)])
        if (offset) return { status: 206, statusText: 'Partial Content', headers, config, data }
      }
    }
    return { status: 200, statusText: 'OK', headers, config, data }
  }
  return calls
}

function params() {
  return {
    url: canonical,
    filepath: join(dir, 'ohio.pmtiles'),
    timeout: 1000,
    allowedMimeTypes: ['application/octet-stream'],
    forceNew: true,
  }
}

test('healthy regional link uses the normal downloader', async () => {
  const calls = source({ direct: true })
  const path = await downloadRegionalMap(params())
  assert.deepEqual(await readFile(path), bytes)
  assert.deepEqual(calls, [canonical, canonical])
})

test('resumes LFS, verifies the object, and keeps the catalog URL in callbacks', async () => {
  const calls = source()
  const download = params()
  await writeFile(download.filepath + '.lfs.tmp', bytes.subarray(0, 4))
  const completed: string[] = []
  const progress: string[] = []
  await downloadRegionalMap({
    ...download,
    onProgress: (p) => {
      progress.push(p.url)
    },
    onComplete: (url) => {
      completed.push(url)
    },
  })
  assert.deepEqual(await readFile(download.filepath), bytes)
  assert.deepEqual(completed, [canonical])
  assert.deepEqual(progress, [canonical])
  assert.equal(calls.filter((url) => url === storage).length, 2)
})

test('wrong bytes never replace an installed map or report completion', async () => {
  source({ contents: Buffer.alloc(bytes.length) })
  const download = params()
  await writeFile(download.filepath, 'previous map')
  await assert.rejects(
    downloadRegionalMap({ ...download, onComplete: () => assert.fail() }),
    /SHA-256/
  )
  assert.equal(await readFile(download.filepath, 'utf8'), 'previous map')
  await assert.rejects(readFile(download.filepath + '.lfs'), { code: 'ENOENT' })
})

test('other hosts, HTTP rejections, and cancelled transfers do not use LFS', async () => {
  const calls = source()
  const tls = new AxiosError('TLS handshake failed', 'EPROTO')
  await assert.rejects(
    regionalMapPointerAfterError('https://example.com/ohio.pmtiles', tls),
    (e) => e === tls
  )
  const rejected = new AxiosError('HTTP 403', 'ERR_BAD_REQUEST')
  await assert.rejects(regionalMapPointerAfterError(canonical, rejected), (e) => e === rejected)
  await assert.rejects(regionalMapPointerAfterError(canonical, tls, AbortSignal.abort()), {
    name: 'AbortError',
  })
  assert.deepEqual(calls, [])
})

test('an unexpected object host is rejected before transfer', async () => {
  const calls = source({ href: 'https://example.com/object' })
  await assert.rejects(downloadRegionalMap(params()), /Unexpected GitHub LFS/)
  assert.equal(calls.length, 3)
})
