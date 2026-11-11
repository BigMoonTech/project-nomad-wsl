# NOMAD Ollama runtime

This image adds Ollama's MLX/CUDA backend to the official ARM64 image so NVIDIA ARM machines such as the GX10 / DGX Spark can run NVFP4 models. It uses Ollama **0.40.16**, source commit `d63b702609c4300a2ca07be2bdb0adb9834725e5`. Both the upstream runtime image and CUDA build image are pinned by digest.

The image tags follow the **NOMAD release** (initially `1.35.105`), not the Ollama engine version. The `io.projectnomad.ollama.version` label records the engine version. The primary release workflow builds this image alongside Command Center and Translate. No fourth manual workflow is needed.

## Selection and upgrades

- New AI Assistant installs select this image on ARM64 only after NOMAD verifies working NVIDIA container access.
- Existing installations receive a normal AI Assistant update offer. After updating Command Center, open **Apps → AI Assistant → Update** and select the NOMAD runtime version. Models, bind mounts, ports and configuration are retained. The old container remains available for rollback until the new Ollama API responds.
- The initial migration crosses the displayed major version (`0.40.16` engine tag → `1.35.105` NOMAD tag), so the existing app auto-update major-version safeguard requires manual selection. Later NOMAD runtime updates use the usual update rules.
- WSL/amd64 Linux continue to select official Ollama images. ARM CPU-only installations, custom images and newer upstream engines are preserved. External Ollama endpoints are not modified.
- The amd64 variant contains the unmodified official runtime payload. The ARM64 variant adds MLX and private dependencies without replacing any existing GGUF/CUDA libraries.

## Correctness and validation

ARM64 uses `MLX_USE_CUDA_GRAPHS=0`. A graph-enabled cold-load test on GB10 produced corrupt output; repeated eager-execution tests were correct. This prioritizes correct results over graph-related speedups. [MLX issue #4700](https://github.com/ml-explore/mlx/issues/4700) reports a related Blackwell graph problem, but it has not been established as the exact cause of our failure. Re-enable graphs only after fresh-process, cold-cache inference tests pass.

PR CI builds both architectures natively, checks every original runtime file against the pinned upstream image, and boots the API without a GPU. Command Center tests cover runtime selection, configuration retention, failed-update rollback and the previous WSL release's database upgrade. GPU release validation additionally runs both `qwen3.8:27b-nvfp4` and `qwen3.8:27b-dflash2-nvfp4` with repeated cold loads, plus GGUF generation and embeddings. A live Windows host is not available for hardware testing.

CUDA targets match the upstream build, including GB10's compute capability 12.1. Compiling these targets takes longer than ordinary NOMAD builds; subsequent builds reuse the dedicated Actions cache. The first model load can also take longer while CUDA compiles kernels.

All build dependencies are installed inside the Docker build stage. The host and other projects' Node, npm, Python and CUDA environments are untouched.
