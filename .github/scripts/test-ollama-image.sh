#!/usr/bin/env bash
# Native, GPU-free compatibility checks. Hardware inference is tested separately.
set -euo pipefail
image=${1:?image required}
base=ollama/ollama:0.40.16@sha256:910d0d8107b538fb0894e63163eb195de0cc7aefcbc666dc62d3b18f71124592
fixture=$(mktemp -d)
container="nomad-runtime-smoke-${fixture##*.}"
cleanup() {
  if [[ $1 != 0 ]]; then docker logs "$container" || true; fi
  docker rm -fv "$container" >/dev/null 2>&1 || true
  rm -r "$fixture"
}
trap 'cleanup $?' EXIT
docker pull "$base"
# Every original file, including GGUF runners and CUDA libraries, must be intact.
docker run --rm --network none --entrypoint sh "$base" -c \
  'find /usr/lib/ollama -type f -exec sha256sum {} +; sha256sum /usr/bin/ollama' > "$fixture/original.sha256"
docker run --rm --network none --entrypoint sh -v "$fixture:/check:ro" "$image" \
  -c 'sha256sum --quiet -c /check/original.sha256'
arch=$(docker image inspect "$image" --format '{{.Architecture}}')
if [[ $arch == arm64 ]]; then
  docker run --rm --network none --entrypoint sh "$image" -ec \
    'test "$MLX_USE_CUDA_GRAPHS" = 0; test -f /usr/lib/ollama/mlx_cuda_v13/libmlx.so'
fi
docker run -d --name "$container" --network none --memory=1g "$image" >/dev/null
ready=false
for attempt in $(seq 1 30); do
  if docker exec "$container" ollama list > "$fixture/models" 2>/dev/null; then ready=true; break; fi
  sleep 1
done
$ready
docker exec "$container" ollama --version | grep -F '0.40.16'
echo "PASS: $arch engine, original payload checksums, empty model list, CPU startup"
