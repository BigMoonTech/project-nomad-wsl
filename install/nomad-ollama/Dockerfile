# The amd64 payload is the official Ollama image. Only arm64 adds MLX/CUDA.
ARG TARGETARCH
FROM nvidia/cuda:13.0.2-cudnn-devel-ubuntu24.04@sha256:e071e85c52ad91fc9ea24158ff5330876b2d1a5c4ac83ccc6066976835873c01 AS mlx
RUN test "$(uname -m)" = aarch64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates libopenblas-dev liblapack-dev liblapacke-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN git clone --depth 1 --branch v0.40.16 https://github.com/ollama/ollama.git source \
    && test "$(git -C source rev-parse HEAD)" = d63b702609c4300a2ca07be2bdb0adb9834725e5
# Match upstream's CUDA targets, including GB10 (12.1). Native ARM compilation;
# no host packages, QEMU, Python environment, or Go rebuild is required.
RUN cmake -S source -B build \
      -DOLLAMA_MLX_BACKENDS=cuda_v13 \
      -DOLLAMA_LLAMA_BACKENDS= \
      '-DMLX_CUDA_ARCHITECTURES=75-virtual;80-virtual;86-virtual;89-virtual;90-virtual;90a-virtual;100-virtual;103-virtual;110-virtual;120-virtual;121-virtual' \
      -DCMAKE_CUDA_FLAGS='-t 1' \
      -DBLAS_INCLUDE_DIRS=/usr/include/aarch64-linux-gnu \
      -DLAPACK_INCLUDE_DIRS=/usr/include/aarch64-linux-gnu \
      -DOLLAMA_PAYLOAD_INSTALL_PREFIX=/build/dist \
    && cmake --build build --target ollama-mlx-cuda_v13 --parallel 2 \
    && cp -a dist/lib/ollama/cuda_v13/. dist/lib/ollama/mlx_cuda_v13/ \
    && rm -rf dist/lib/ollama/cuda_v13
# Keep MLX's dependencies private. In particular, never replace the official
# llama-server/CUDA libraries used by existing GGUF models and embeddings.
FROM ollama/ollama:0.40.16@sha256:910d0d8107b538fb0894e63163eb195de0cc7aefcbc666dc62d3b18f71124592 AS runtime-amd64
FROM runtime-amd64 AS runtime-arm64
COPY --from=mlx /build/dist/lib/ollama/ /usr/lib/ollama/
# Blackwell graph execution produced corrupt output in a cold-load test.
# Keep eager CUDA execution until a graph-enabled build passes correctness tests.
ENV MLX_USE_CUDA_GRAPHS=0
FROM runtime-${TARGETARCH}
ARG VERSION=dev
ARG VCS_REF
ARG BUILD_DATE
LABEL org.opencontainers.image.source="https://github.com/BigMoonTech/project-nomad-wsl" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      io.projectnomad.ollama.version="0.40.16"
