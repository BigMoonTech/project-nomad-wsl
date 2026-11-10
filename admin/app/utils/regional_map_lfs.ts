import axios from 'axios'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rename } from 'node:fs/promises'
import type { DoResumableDownloadParams } from '../../types/downloads.js'
import { doResumableDownload, GatedContentAuthError } from './downloads.js'
import { deleteFileIfExists, getFileStatsIfExists } from './fs.js'

const repo = 'Crosstalk-Solutions/project-nomad-maps'
const mapUrl =
  /^https:\/\/github\.com\/Crosstalk-Solutions\/project-nomad-maps\/raw\/(?:refs\/heads\/)?master\/pmtiles\/([a-zA-Z0-9_-]+\.pmtiles)$/
const transportErrors = new Set([
  'EPROTO',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
])
const lfsMediaType = 'application/vnd.git-lfs+json'

/** The raw endpoint returns the small Git pointer. The browser download URL serves the bytes. */
export async function regionalMapPointerAfterError(
  url: string,
  error: unknown,
  signal?: AbortSignal
) {
  const filename = mapUrl.exec(url)?.[1]
  signal?.throwIfAborted()
  if (!filename || !transportErrors.has((error as NodeJS.ErrnoException)?.code ?? '')) throw error

  const { data } = await axios.get<string>(
    `https://raw.githubusercontent.com/${repo}/master/pmtiles/${filename}`,
    { responseType: 'text', maxRedirects: 0, maxContentLength: 1024, timeout: 15000, signal }
  )
  const match =
    /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize ([0-9]+)$/.exec(
      data.trim()
    )
  const size = Number(match?.[2])
  if (!match || !Number.isSafeInteger(size) || size <= 0)
    throw new Error('Invalid upstream map LFS pointer')
  return { oid: match[1], size }
}

async function getDownloadUrl(pointer: { oid: string; size: number }, signal?: AbortSignal) {
  const { data } = await axios.post(
    `https://github.com/${repo}.git/info/lfs/objects/batch`,
    { operation: 'download', transfers: ['basic'], objects: [pointer] },
    {
      headers: { Accept: lfsMediaType, 'Content-Type': lfsMediaType },
      timeout: 15000,
      maxRedirects: 0,
      maxContentLength: 65536,
      signal,
    }
  )
  const object = data?.objects?.[0]
  if (
    object?.oid !== pointer.oid ||
    object.size !== pointer.size ||
    !object.actions?.download?.href
  ) {
    throw new Error('GitHub LFS did not return the requested map object')
  }
  const url = new URL(object.actions.download.href)
  if (url.origin !== 'https://github-cloud.githubusercontent.com' || url.username || url.password) {
    throw new Error('Unexpected GitHub LFS map download host')
  }
  return url.href
}

export async function downloadRegionalMap(params: DoResumableDownloadParams): Promise<string> {
  let pointer
  try {
    return await doResumableDownload(params)
  } catch (error) {
    if (params.requestHeaders && Object.keys(params.requestHeaders).length) throw error
    pointer = await regionalMapPointerAfterError(params.url, error, params.signal)
  }

  const signedUrl = await getDownloadUrl(pointer, params.signal)
  // The shared downloader resumes this staging file across retries. Only the
  // verified bytes are renamed to .pmtiles, where the map server can see them.
  const staged = params.filepath + '.lfs'
  try {
    await doResumableDownload(
      {
        ...params,
        url: signedUrl,
        filepath: staged,
        requestHeaders: undefined,
        forceNew: false,
        onProgress: (progress) => params.onProgress?.({ ...progress, url: params.url }),
        onComplete: undefined,
      },
      axios.create({ maxRedirects: 0 })
    )
  } catch (error) {
    // A retry gets a fresh signed URL from GitHub.
    if (error instanceof GatedContentAuthError)
      throw new Error('GitHub rejected its temporary LFS download URL')
    throw error
  }

  const hash = createHash('sha256')
  const stats = await getFileStatsIfExists(staged)
  if (stats?.size === pointer.size) {
    for await (const chunk of createReadStream(staged, { signal: params.signal }))
      hash.update(chunk)
  }
  if (stats?.size !== pointer.size || hash.digest('hex') !== pointer.oid) {
    await deleteFileIfExists(staged)
    throw new Error('Downloaded regional map does not match its upstream LFS size and SHA-256')
  }
  params.signal?.throwIfAborted()
  await rename(staged, params.filepath)
  await deleteFileIfExists(params.filepath + '.tmp')
  await params.onComplete?.(params.url, params.filepath)
  return params.filepath
}
