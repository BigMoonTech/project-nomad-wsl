import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { Header, extract } from 'tar'

function member(path: string, data = Buffer.alloc(0), type = 'File', linkpath = '') {
  const header = new Header({
    path,
    size: data.length,
    type: type as 'File' | 'ExtendedHeader' | 'SymbolicLink',
    linkpath,
    mode: 0o644,
    uid: 0,
    gid: 0,
    mtime: new Date(0),
  })
  const block = Buffer.alloc(512)
  header.encode(block)
  return Buffer.concat([block, data, Buffer.alloc((512 - (data.length % 512)) % 512)])
}

function pax(key: string, value: string) {
  const line = ` ${key}=${value}\n`
  let size = Buffer.byteLength(line) + 1
  while (size !== Buffer.byteLength(line) + String(size).length) {
    size = Buffer.byteLength(line) + String(size).length
  }
  return member('PaxHeader', Buffer.from(`${size}${line}`), 'ExtendedHeader')
}

// Exercise the same file extraction options as MapService.downloadBaseAssets.
// Fixtures are bounded (at most 16 MiB expanded), and never touch installed maps.
async function withArchive(members: Buffer[], check: (file: string, cwd: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'nomad-archive-test-'))
  try {
    const cwd = join(dir, 'maps')
    const file = join(dir, 'base-assets.tar.gz')
    await mkdir(cwd)
    await writeFile(file, gzipSync(Buffer.concat([...members, Buffer.alloc(1024)])))
    await check(file, cwd)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('base assets retain styles, sprites, and font paths containing spaces', async () => {
  const assets = {
    'nomad-base-styles.json': '{"version":8}',
    'basemaps-assets/fonts/Noto Sans Regular/0-255.pbf': 'font fixture',
    'basemaps-assets/sprites/v4/light.json': '{}',
  }
  await withArchive(
    Object.entries(assets).map(([path, data]) => member(`tozip/${path}`, Buffer.from(data))),
    async (file, cwd) => {
      await extract({ file, cwd, strip: 1 })
      for (const [path, data] of Object.entries(assets)) {
        assert.equal(await readFile(join(cwd, path), 'utf8'), data)
      }
    }
  )
})

test('excessive gzip expansion rejects instead of extracting the entire payload', async () => {
  await withArchive([member('tozip/expansion', Buffer.alloc(16 * 1024 * 1024))], async (file, cwd) => {
    await assert.rejects(extract({ file, cwd, strip: 1 }), /decompression ratio/i)
  })
})

test('numeric PAX paths do not disrupt subsequent map assets', async () => {
  await withArchive(
    [
      pax('path', '123456'),
      member('tozip/ignored', Buffer.from('stripped root entry')),
      member('tozip/control', Buffer.from('ok')),
    ],
    async (file, cwd) => {
      await extract({ file, cwd, strip: 1 })
      assert.equal(await readFile(join(cwd, 'control'), 'utf8'), 'ok')
    }
  )
})

test('PAX paths with NUL bytes cannot crash the extracting process', async () => {
  await withArchive(
    [pax('path', 'tozip/visible\0hidden'), member('tozip/ignored', Buffer.from('ok'))],
    async (file, cwd) => {
      await extract({ file, cwd, strip: 1 })
      assert.equal(await readFile(join(cwd, 'visible'), 'utf8'), 'ok')
    }
  )
})

test('PAX link targets with NUL bytes cannot crash the extracting process', async () => {
  await withArchive(
    [
      member('tozip/target', Buffer.from('ok')),
      pax('linkpath', 'target\0hidden'),
      member('tozip/link', Buffer.alloc(0), 'SymbolicLink', 'target'),
    ],
    async (file, cwd) => {
      await extract({ file, cwd, strip: 1 })
      assert.equal(await readFile(join(cwd, 'link'), 'utf8'), 'ok')
    }
  )
})
