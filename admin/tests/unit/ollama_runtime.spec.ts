import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canMigrateOllamaRuntime, nomadOllamaRelease, ollamaRuntimeEnv,
  selectOllamaRuntimeImage, NOMAD_OLLAMA_REPOSITORY,
} from '../../app/utils/ollama_runtime.js'

const official = 'ollama/ollama:0.40.16'
const managed = `${NOMAD_OLLAMA_REPOSITORY}:1.35.105`

test('WSL and amd64 Linux keep upstream images with NVIDIA, AMD, or CPU', () => {
  for (const arch of ['amd64', 'x86_64']) for (const gpu of ['nvidia', 'amd', 'none']) {
    assert.equal(selectOllamaRuntimeImage(official, arch, gpu, '1.35.105'), official)
    assert.equal(selectOllamaRuntimeImage(official, arch, gpu, '1.35.105', '0.40.17'), 'ollama/ollama:0.40.17')
  }
})

test('ARM64 selects MLX only with verified NVIDIA access', () => {
  for (const arch of ['arm64', 'aarch64']) {
    assert.equal(selectOllamaRuntimeImage(official, arch, 'nvidia', '1.35.105'), managed)
    assert.equal(selectOllamaRuntimeImage(official, arch, 'none', '1.35.105'), official)
    assert.equal(selectOllamaRuntimeImage(official, arch, 'amd', '1.35.105'), official)
  }
  assert.equal(selectOllamaRuntimeImage(official, '', 'nvidia', '1.35.105'), official)
})

test('custom, rolling, digest-pinned and newer upstream engines are preserved', () => {
  for (const image of ['mine/ollama:0.40.16', 'ollama/ollama:latest', 'ollama/ollama:rocm',
    'ollama/ollama@sha256:1234', 'ollama/ollama:0.40.17', 'ollama/ollama:0.41.0']) {
    assert.equal(canMigrateOllamaRuntime(image, 'arm64', 'nvidia'), false)
    assert.equal(selectOllamaRuntimeImage(image, 'arm64', 'nvidia', '1.35.105'), image)
  }
})

test('official Docker Hub aliases and older engines can migrate', () => {
  for (const image of ['ollama/ollama:0.33.3', 'docker.io/ollama/ollama:0.40.16', 'registry-1.docker.io/ollama/ollama:v0.40.16']) {
    assert.equal(selectOllamaRuntimeImage(image, 'arm64', 'nvidia', '1.35.105', '1.35.105'), managed)
  }
})

test('runtime update tags stay in the managed repository; upstream updates stay upstream', () => {
  assert.equal(selectOllamaRuntimeImage(managed, 'arm64', 'nvidia', '1.35.105', '1.35.106'), `${NOMAD_OLLAMA_REPOSITORY}:1.35.106`)
  assert.equal(selectOllamaRuntimeImage(managed, 'arm64', 'none', '1.35.105'), managed)
  assert.throws(() => selectOllamaRuntimeImage(managed, 'arm64', 'nvidia', '1.35.105', '0.40.17'))
  assert.equal(selectOllamaRuntimeImage(official, 'arm64', 'nvidia', '1.35.105', '0.40.17'), 'ollama/ollama:0.40.17')
  assert.equal(selectOllamaRuntimeImage('localhost:5000/ollama', 'arm64', 'nvidia', '1.35.105', '2.0.0'), 'localhost:5000/ollama:2.0.0')
})

test('the graph workaround survives ARM updates without changing amd64 or custom environments', () => {
  const original = ['KEEP=unchanged', 'MLX_USE_CUDA_GRAPHS=1', 'OLLAMA_CONTEXT_LENGTH=4096']
  assert.deepEqual(ollamaRuntimeEnv(managed, 'arm64', original), ['KEEP=unchanged', 'OLLAMA_CONTEXT_LENGTH=4096', 'MLX_USE_CUDA_GRAPHS=0'])
  assert.equal(ollamaRuntimeEnv(managed, 'amd64', original), original)
  assert.equal(ollamaRuntimeEnv(official, 'arm64', original), original)
  assert.equal(original[1], 'MLX_USE_CUDA_GRAPHS=1')
})

test('production image selection uses the release version; CI has an explicit stable baseline', () => {
  assert.equal(nomadOllamaRelease('v1.35.106'), '1.35.106')
  assert.equal(nomadOllamaRelease('ci'), '1.35.105')
  assert.equal(nomadOllamaRelease('1.35.104'), '1.35.105')
})
