// Hardware release gate. Run against an isolated GPU container, never an unrelated endpoint.
// NVFP4 mode requires both selected Qwen tags in its test model cache. GGUF mode
// uses the existing NOMAD cache mounted read-only, without downloading or deleting models.
import assert from 'node:assert/strict'
const base = process.env.OLLAMA_TEST_URL
assert.ok(base, 'Set OLLAMA_TEST_URL to the isolated container')
const mode = process.env.OLLAMA_TEST_MODE || 'nvfp4'
async function request(path, body) {
  const start = Date.now()
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(600000),
  })
  const data = await response.json()
  assert.ok(response.ok && !data.error, JSON.stringify({ status: response.status, data }))
  return { data, seconds: (Date.now() - start) / 1000 }
}
assert.equal((await request('/api/version')).data.version, '0.40.16')
if (mode === 'nvfp4') {
  for (const model of ['qwen3.8:27b-nvfp4', 'qwen3.8:27b-dflash2-nvfp4']) {
    // Re-check the manifest and checksums through Ollama's actual pull handler.
    assert.equal((await request('/api/pull', { model, stream: false })).data.status, 'success')
    const cases = [
      { name: 'cold exact text', path: '/api/generate', prompt: 'Reply with exactly: NOMAD NVFP4 inference works.', expected: 'NOMAD NVFP4 inference works.' },
      { name: 'cold arithmetic', path: '/api/generate', prompt: 'What is 17 plus 25? Reply with only the number.', expected: '42' },
      { name: 'structured output', path: '/api/generate', prompt: 'What is 17 plus 25? Return a JSON object with the numeric answer.',
        format: { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false }, json: { answer: 42 } },
      { name: 'multi-turn chat', path: '/api/chat', messages: [
        { role: 'user', content: 'Remember this code: NOMAD-314.' },
        { role: 'assistant', content: 'I will remember the code.' },
        { role: 'user', content: 'What was the code? Reply with only the code.' },
      ], expected: 'NOMAD-314' },
      { name: '8k context', path: '/api/generate', context: 8192, keepAlive: '2m',
        prompt: 'The special access code is SPARK-742.\n' + Array.from({ length: 180 }, (_, i) => `Record ${i}: this is unrelated archive content.`).join('\n') + '\nWhat is the special access code? Reply with only the code.', expected: 'SPARK-742' },
      { name: 'warm follow-up', path: '/api/generate', context: 8192,
        prompt: 'What is 17 plus 25? Reply with only the number.', expected: '42' },
    ]
    for (const test of cases) {
      const { data, seconds } = await request(test.path, {
        model, ...(test.messages ? { messages: test.messages } : { prompt: test.prompt }),
        ...(test.format && { format: test.format }), think: false, stream: false, keep_alive: test.keepAlive ?? 0,
        options: { num_ctx: test.context || 4096, num_predict: 64, temperature: 0, seed: 0 },
      })
      const answer = (data.response ?? data.message?.content ?? '').trim()
      console.log(JSON.stringify({ model, test: test.name, answer, seconds, tokens: data.eval_count, promptTokens: data.prompt_eval_count, evalSeconds: data.eval_duration / 1e9, loadSeconds: data.load_duration / 1e9 }))
      assert.ok(data.done)
      assert.equal(data.done_reason, 'stop')
      if (test.json) assert.deepEqual(JSON.parse(answer), test.json)
      else assert.equal(answer, test.expected)
      if (test.keepAlive) {
        const loaded = (await request('/api/ps')).data.models.find((entry) => entry.name === model)
        assert.ok(loaded?.size_vram > 0, 'NVFP4 must use the GPU')
        console.log(JSON.stringify({ model, test: 'GPU residency', bytes: loaded.size_vram }))
      }
    }
  }
} else if (mode === 'gguf') {
  const { data, seconds } = await request('/api/generate', { model: 'deepseek-r1:latest',
    prompt: 'What is 17 plus 25? Reply with only the number.', think: false, stream: false,
    keep_alive: '30s', options: { num_ctx: 2048, num_predict: 512, temperature: 0, seed: 0 } })
  console.log(JSON.stringify({ test: 'GGUF generation', response: data.response, seconds, tokens: data.eval_count }))
  const visible = data.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  assert.ok(data.done && data.done_reason === 'stop' && /\b42\b/.test(visible))
  const loaded = (await request('/api/ps')).data.models.find((model) => model.name === 'deepseek-r1:latest')
  assert.ok(loaded?.size_vram > 0, 'GGUF must use the GPU')
  await request('/api/generate', { model: 'deepseek-r1:latest', keep_alive: 0 })
  const embedding = (await request('/api/embed', { model: 'nomic-embed-text:v1.5', input: ['NOMAD offline documentation', 'Maps and reference library'], keep_alive: 0 })).data.embeddings
  assert.equal(embedding.length, 2)
  for (const vector of embedding) {
    assert.equal(vector.length, 768)
    assert.ok(vector.every(Number.isFinite) && vector.some((value) => value !== 0))
  }
  assert.notDeepEqual(embedding[0], embedding[1])
  console.log('PASS: GGUF GPU generation and 768-dimensional embeddings')
} else throw new Error(`Unknown test mode: ${mode}`)
console.log(`PASS: ${mode} hardware release gate`)
