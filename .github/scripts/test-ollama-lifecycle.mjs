// Run only inside smoke-compose's disposable database with no Docker socket.
import assert from 'node:assert/strict'
import 'reflect-metadata'
import { Ignitor } from '@adonisjs/core'

const root = new URL('file:///app/')
const app = new Ignitor(root, { importer: (path) => import(path.startsWith('.') ? new URL(path, root).href : path) })
  .tap((application) => application.booting(() => import('#start/env'))).createApp('console')
await app.init()
await app.boot()
try {
  const { default: Service } = await import('#models/service')
  const { DockerService } = await import('./app/services/docker_service.js')
  const { RagService } = await import('./app/services/rag_service.js')
  RagService.prototype.discoverNomadDocs = async () => {}
  const official = 'ollama/ollama:0.40.16'
  const managed = 'ghcr.io/bigmoontech/project-nomad-wsl-ollama:1.35.105'
  const name = 'nomad_ollama'
  const binds = ['/opt/project-nomad/storage/ollama:/root/.ollama']
  const ports = { '11434/tcp': [{ HostIp: '127.0.0.1', HostPort: '12434' }] }
  const env = ['KEEP=retained', 'OLLAMA_CONTEXT_LENGTH=4096', 'MLX_USE_CUDA_GRAPHS=1']
  const config = { Env: env, HostConfig: { Binds: binds, PortBindings: ports, RestartPolicy: { Name: 'unless-stopped' } } }
  let passed = 0

  for (const scenario of [
    { label: 'ARM NVIDIA install', arch: 'aarch64', gpu: 'nvidia', fresh: true, expected: managed },
    { label: 'ARM NVIDIA update preserves data and config', arch: 'aarch64', gpu: 'nvidia', expected: managed },
    { label: 'unhealthy ARM runtime rolls back', arch: 'arm64', gpu: 'nvidia', healthy: false, expected: managed },
    { label: 'WSL/amd64 NVIDIA keeps upstream', arch: 'x86_64', gpu: 'nvidia', target: '0.40.17', expected: 'ollama/ollama:0.40.17' },
    { label: 'ARM CPU keeps upstream', arch: 'aarch64', gpu: 'none', target: '0.40.17', expected: 'ollama/ollama:0.40.17' },
    { label: 'custom ARM image stays custom', arch: 'aarch64', gpu: 'nvidia', custom: true, image: 'mine/ollama:0.40.16', target: '0.40.17', expected: 'mine/ollama:0.40.17' },
  ]) {
    const service = await Service.findByOrFail('service_name', name)
    service.merge({ container_image: scenario.image || official, installed: !scenario.fresh, installation_status: 'idle',
      source_repo: 'https://github.com/ollama/ollama', is_custom: !!scenario.custom, is_user_modified: false, depends_on: null })
    await service.save()
    let oldName = name, oldRunning = true, oldRemoved = false, newRemoved = false, created, pulled, healthChecks = 0
    const old = {
      inspect: async () => ({ Config: { Env: env, Cmd: ['serve'] }, HostConfig: config.HostConfig, NetworkSettings: { Networks: { nomad_test: {} } } }),
      stop: async () => { oldRunning = false }, start: async () => { oldRunning = true },
      rename: async ({ name: next }) => { oldName = next }, remove: async () => { oldRemoved = true },
    }
    const replacement = { start: async () => {}, stop: async () => {}, remove: async () => { newRemoved = true },
      inspect: async () => ({ State: { Running: true } }) }
    const docker = new DockerService()
    docker.docker = {
      info: async () => ({ Architecture: scenario.arch }),
      listContainers: async () => oldRemoved ? [] : [{ Id: 'old', Names: [`/${oldName}`], State: oldRunning ? 'running' : 'exited' }],
      getContainer: () => old,
      createContainer: async (options) => { created = options; return replacement },
    }
    docker._detectGPUType = async () => ({ type: scenario.gpu })
    docker._broadcast = () => {}
    docker._applyHostStorageRoot = async () => {}
    docker._checkImageExists = async () => false
    docker.pullImage = async (image) => { pulled = image }
    docker._waitForOllamaApi = async () => { healthChecks++; return scenario.healthy !== false }
    if (scenario.fresh) await docker._createContainer(service, structuredClone(config))
    else {
      const result = await docker.updateContainer(name, scenario.target || '1.35.105')
      assert.equal(result.success, scenario.healthy !== false, JSON.stringify(result))
    }
    assert.equal(pulled, scenario.expected)
    assert.equal(created.Image, scenario.expected)
    assert.deepEqual(created.HostConfig.Binds, binds)
    assert.deepEqual(created.HostConfig.PortBindings, ports)
    assert.ok(created.Env.includes('KEEP=retained'))
    assert.ok(created.Env.includes('OLLAMA_CONTEXT_LENGTH=4096'))
    assert.equal(!!created.HostConfig.DeviceRequests?.length, scenario.gpu === 'nvidia')
    const saved = await Service.findByOrFail('service_name', name)
    assert.equal(saved.installation_status, 'idle')
    if (scenario.healthy === false) {
      assert.equal(oldName, name); assert.ok(oldRunning); assert.ok(newRemoved); assert.ok(!oldRemoved)
      assert.equal(saved.container_image, official)
      assert.equal(saved.source_repo, 'https://github.com/ollama/ollama')
    } else {
      assert.equal(saved.container_image, scenario.expected)
      if (!scenario.fresh) assert.ok(oldRemoved)
    }
    if (scenario.expected === managed) {
      assert.equal(healthChecks, 1)
      assert.ok(created.Env.includes('MLX_USE_CUDA_GRAPHS=0'))
      assert.ok(!created.Env.includes('MLX_USE_CUDA_GRAPHS=1'))
    } else {
      assert.equal(healthChecks, 0)
      assert.deepEqual(created.Env, env)
    }
    console.log(`PASS: ${scenario.label}`)
    passed++
  }
  console.log(`PASS: ${passed} Ollama lifecycle scenarios against the disposable database`)
} finally {
  await app.terminate()
}
