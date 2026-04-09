# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project N.O.M.A.D. (Node for Offline Media, Archives, and Data) is an offline-first knowledge and education server. It provides a "Command Center" web UI that orchestrates containerized tools (AI chat, offline Wikipedia, maps, education platform, etc.) via Docker. This fork targets Windows deployment using WSL2 and Docker Desktop.

## Development Commands

All commands run from the `admin/` directory:

```bash
cd admin
npm ci                          # Install dependencies
npm run dev                     # Dev server with HMR (port 8080)
npm run build                   # Production build (node ace build)
npm run test                    # Run tests (Japa runner)
node ace test --suite=unit      # Run only unit tests
node ace test --suite=functional # Run only functional tests
npm run lint                    # ESLint
npm run format                  # Prettier
npm run typecheck               # TypeScript type checking
```

### Background Workers (require Redis)

```bash
npm run work:all                # All queues
npm run work:downloads          # File download queue only
npm run work:model-downloads    # LLM model download queue only
npm run work:benchmarks         # Benchmark queue only
```

### Database (requires MySQL)

```bash
node ace migration:run          # Run migrations
node ace db:seed                # Seed database
node ace migration:rollback     # Rollback last batch
```

### Docker (production)

```bash
docker compose -f install/management_compose.yaml up -d    # Start all services
docker compose -f install/management_compose.yaml down      # Stop all services
```

## Required Services for Development

- **MySQL 8.0** on port 3306 (database: `nomad`)
- **Redis 7** on port 6379 (for BullMQ job queues)
- **Docker** socket access (for container management via dockerode)

Copy `admin/.env.example` to `admin/.env`. On Windows dev, set `NOMAD_STORAGE_PATH` to a local path like `C:/nomad-storage`.

## Architecture

### Tech Stack

- **Backend**: AdonisJS 6 (TypeScript MVC framework), Lucid ORM, MySQL, Redis + BullMQ
- **Frontend**: React 19 + Inertia.js (server-driven SPA), Tailwind CSS 4, Vite
- **Infrastructure**: Docker Compose with Docker-outside-of-Docker (DooD) pattern

### How Inertia.js Works Here

AdonisJS controllers render React pages via Inertia — there is no separate API client. Controllers call `inertia.render('page_name', props)` and the React frontend receives props directly. API-only endpoints (prefixed `/api/`) return JSON.

### Docker-outside-of-Docker (DooD)

The admin container mounts the host's Docker socket (`/var/run/docker.sock`) to manage sibling containers (Ollama, Kiwix, Qdrant, etc.) using the `dockerode` library. It does NOT run Docker inside Docker. All managed containers use the `nomad_` prefix.

### Key Backend Patterns

- **Controllers** (`admin/app/controllers/`) — HTTP handlers, one per feature domain
- **Services** (`admin/app/services/`) — Business logic. `docker_service.ts` (container lifecycle), `ollama_service.ts` (LLM ops), `rag_service.ts` (document chunking/embedding/search via Qdrant), `system_service.ts` (host info)
- **Jobs** (`admin/app/jobs/`) — BullMQ background jobs for downloads, model pulls, benchmarks, and update checks
- **Models** (`admin/app/models/`) — Lucid ORM models backed by MySQL
- **Constants** (`admin/constants/`) — Service names, Ollama model definitions, KV store keys
- **Validators** (`admin/app/validators/`) — VineJS request validation schemas
- **Routes** defined in `admin/start/routes.ts`, middleware in `admin/start/kernel.ts`

### Key Frontend Patterns

- **Pages** (`admin/inertia/pages/`) — Top-level route components: `home.tsx`, `chat.tsx`, `maps.tsx`, `settings/`, `easy-setup/`
- **Components** (`admin/inertia/components/`) — Reusable React components
- **Path alias**: `~/` maps to `admin/inertia/` in imports (configured in Vite)
- **Real-time**: `@adonisjs/transmit` provides WebSocket-based server-sent events for live updates (download progress, service logs, benchmarks)

### Managed Services

These are Docker containers managed by the Command Center UI:

| Service | Container Name | Purpose |
|---------|---------------|---------|
| Ollama | nomad_ollama | Local LLM inference |
| Qdrant | nomad_qdrant | Vector DB for RAG search |
| Kiwix | nomad_kiwix_server | Offline Wikipedia/content |
| Kolibri | nomad_kolibri | Education platform |
| CyberChef | nomad_cyberchef | Data encoding/analysis |
| FlatNotes | nomad_flatnotes | Markdown notes |

### RAG Pipeline

1. User uploads document → `rag_service.ts` processes it (PDF parsing, OCR via Tesseract.js, text extraction)
2. Document chunked into ~1500-token segments
3. Chunks embedded via Ollama embedding model → stored in Qdrant vector DB
4. User query embedded → semantic search in Qdrant → context injected into LLM prompt

## Conventions

- **Conventional Commits**: `feat(scope):`, `fix(scope):`, `docs:`, `refactor:`, `chore:`, `test:`
- **Branching**: Feature branches off `dev` (e.g., `fix/issue-123`, `feature/add-new-tool`). PRs target `dev`.
- **Versioning**: Root `package.json` version managed by semantic-release. `admin/package.json` stays at `0.0.0` — do not change it.
- **Release notes**: Maintained in `admin/docs/release-notes.md` by maintainers, not in PRs.
- **Module imports**: Use `#` subpath imports (e.g., `#services/docker_service`, `#models/service`). Defined in `admin/package.json` `imports` field.

## Windows/WSL2 Deployment

This fork targets Windows via **WSL2 Ubuntu + Docker Desktop**. The install script (`install/install_nomad.sh`) detects WSL2 automatically via `grep -qi microsoft /proc/version` and adjusts its behavior:

- **Docker:** Provided by Docker Desktop, not installed via apt. Script skips `systemctl` checks and uses `docker info` to verify the daemon.
- **NVIDIA GPU:** Handled entirely by Docker Desktop + the NVIDIA Windows driver (525.60.13+). The script skips `nvidia-container-toolkit` installation and `daemon.json` modification on WSL2 — those are for native Linux only.
- **Storage:** Uses `/opt/project-nomad/` inside the WSL2 filesystem (same as native Linux).
- **Docker socket:** `/var/run/docker.sock` is injected into WSL2 by Docker Desktop automatically.

See `install/windows/README.md` for the full Windows installation guide.
