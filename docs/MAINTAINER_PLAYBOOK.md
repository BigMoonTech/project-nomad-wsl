# BigMoonTech Project N.O.M.A.D. WSL2 Fork — Maintainer Playbook

This is the operations guide for maintaining the fork: how it's wired together, how to release new versions, how to pull in upstream changes, and how to troubleshoot when things go sideways.

---

## Part 1: How the Fork Is Wired Together

### Repository
- **Fork:** https://github.com/BigMoonTech/project-nomad-wsl
- **Upstream:** https://github.com/Crosstalk-Solutions/project-nomad
- **License:** Apache 2.0 (inherited from upstream — must keep)

### Container Registry (GHCR — GitHub Container Registry)
All Docker images are published under `ghcr.io/bigmoontech/`:
- `ghcr.io/bigmoontech/project-nomad-wsl` — the main admin/Command Center image
- `ghcr.io/bigmoontech/project-nomad-wsl-sidecar-updater` — the updater sidecar (handles in-app updates)
- `ghcr.io/bigmoontech/project-nomad-wsl-disk-collector` — the disk info collector sidecar

### Deployed Install
- **Path on WSL2:** `/opt/project-nomad/`
- **Compose file:** `/opt/project-nomad/compose.yml` (downloaded from your fork at install time)
- **Helper scripts:** `/opt/project-nomad/start_nomad.sh`, `stop_nomad.sh`, `update_nomad.sh`
- **Storage:** `/opt/project-nomad/storage/` (ZIM files, uploads, logs)
- **MySQL data:** `/opt/project-nomad/mysql/`
- **Redis data:** `/opt/project-nomad/redis/`

### What Makes This Fork Different From Upstream

| Area | Change |
|------|--------|
| `install/install_nomad.sh` | Detects WSL2 via `grep -qi microsoft /proc/version` and skips `systemctl` checks, `nvidia-container-toolkit` install, and `daemon.json` modification. Verifies Docker Desktop instead. |
| GPU support | On WSL2, relies on Docker Desktop's built-in NVIDIA runtime + Windows NVIDIA driver (525.60.13+). Native Linux path unchanged. |
| `install/management_compose.yaml` | All three image references point to `ghcr.io/bigmoontech/*`. On WSL2, the install script replaces `/:/host:ro,rslave` with `/:/host:ro` (rslave mount propagation isn't supported in WSL2). |
| `install/sidecar-updater/update-watcher.sh` | sed pattern updated to match `ghcr.io/bigmoontech/project-nomad-wsl` images during in-app updates. |
| `admin/app/services/system_service.ts` | GitHub API calls for "check for updates" point to `BigMoonTech/project-nomad-wsl/releases` instead of upstream. |
| `Dockerfile` labels | OCI labels reflect BigMoonTech as the image vendor with attribution to Crosstalk Solutions. |
| `.github/workflows/build-*.yml` | Removed Crosstalk's `DEPLOYMENT_AUTHORIZED_USERS` auth check. Builds publish to your GHCR. |
| `README.md`, `FAQ.md`, `admin/docs/faq.md`, support page, debug modal, issue templates | Clear "unofficial WSL2 fork" positioning with smart routing: WSL2-specific issues to your repo, general N.O.M.A.D. issues to upstream. |

### What's Intentionally Unchanged (Keeps Upstream Attribution)
- `LICENSE` (Apache 2.0 copyright, legally required)
- `admin/docs/about.md`, `admin/docs/release-notes.md`, `admin/docs/use-cases.md`, `admin/docs/community-add-ons.md`
- `admin/inertia/pages/settings/legal.tsx` (legal copyright notice)
- Service files fetching upstream-curated data:
  - `admin/app/services/collection_manifest_service.ts` — Wikipedia/Kiwix/maps catalogs
  - `admin/app/services/map_service.ts` — map tile downloads (gigabytes hosted upstream)
  - `admin/app/services/zim_service.ts` — Wikipedia version options
  - `admin/app/services/docker_service.ts` — sample 4MB Wikipedia ZIM file URL
  - `collections/maps.json` — map tile URLs

These point at upstream so the fork inherits content updates automatically. Forking the data would mean mirroring gigabytes of map tiles.

### Active GitHub Actions Workflows
1. **Build Primary Docker Image** (`build-primary-image.yml`) — manual trigger
2. **Build Sidecar Updater Image** (`build-sidecar-updater.yml`) — manual trigger
3. **Build Disk Collector Image** (`build-disk-collector.yml`) — manual trigger
4. **Build Admin** (`build-admin-on-pr.yml`) — automatic on PR (sanity check, no artifacts)
5. **Validate Collection URLs** (`validate-collection-urls.yml`) — automatic on push to collections/

### Removed Workflows
- ~~`release.yml`~~ — Upstream's semantic-release automation. Required Crosstalk's `COSMISTACKBOT_ACCESS_TOKEN` and bot identity. Removed; we cut releases manually instead.

---

## Part 2: How Versioning Works (Read This First)

### The Single Source of Truth
The version string the running app reports comes from **the workflow input field**, NOT from `package.json`.

When you trigger "Build Primary Docker Image" with version `1.32.0`:
1. The workflow passes `--build-arg VERSION=1.32.0` to the Docker build
2. The Dockerfile runs `RUN echo "{\"version\":\"${VERSION}\"}" > /app/version.json`
3. At runtime, the admin app reads `/app/version.json` to display the version
4. The image is tagged `:1.32.0`, `:v1.32.0`, and `:latest`

### Why This Matters
Whatever you type in the workflow input becomes:
- The version shown in the Debug Info modal
- The version compared against GitHub releases for the "update available" check
- The Docker image tag

`package.json` version is essentially decorative now — the source of truth is the workflow input.

### Versioning Rule

A fork can't stay numerically in sync with an upstream that ships its own patches on its own schedule. Trying to "match their next number" breaks the moment upstream releases a patch you didn't anticipate. (That's exactly what happened: the fork shipped its own `1.32.1`/`1.32.2` fixes, then upstream released a *different* `1.32.1`.) So the fork tracks upstream in the parts of the version it controls, while making collisions structurally impossible.

**Scheme: `<upstream MAJOR>.<upstream MINOR>.<PFF>`**
- The patch's **hundreds digit (P)** = upstream's patch number.
- The **low two digits (FF)** = the fork's own release sequence on that base.

Two-part rule for the sequence:
- Merging an upstream **patch** release `.Z` (where Z ≥ 1) → fork starts at **`.Z00`** (then `Z01`, `Z02`, …).
- Merging an upstream **minor** release `.0` (a new minor) → fork starts at **`.001`** (then `002`, `003`, …) — not `.000`, so it reads as its own thing rather than a bare `.0`.

| Upstream releases | Fork ships | Why |
|---|---|---|
| 1.32.0 | 1.32.001 | new minor → start at `.001` |
| (fork-only fixes) | 1.32.002, 1.32.003 | increment low digits |
| **1.32.1** | **1.32.100** | upstream patch 1 → `.100` |
| (fork-only fixes) | 1.32.101, 1.32.102 | increment low digits |
| 1.32.2 | 1.32.200 | upstream patch 2 → `.200` |
| 1.33.0 | 1.33.001 | new minor → start at `.001` |
| 1.33.1 | 1.33.100 | upstream patch 1 → `.100` |

This works because upstream's SemVer patches (`.0`, `.1`, `.2`…) never reach 100 within a minor line, so the fork's `.100`+ numbers can never collide with a real upstream release. It stays monotonic across both fork-only releases and upstream re-syncs (e.g. `1.32.103` → `1.33.001` still increases because the minor went up).

**Rules that keep it from breaking:**
- **Never** match upstream's exact released number with a real fork release.
- **Never** use a `-suffix` like `-wsl.1` — `isNewerVersion()` (`admin/app/utils/version.ts`) treats hyphenated versions as pre-releases that won't trigger update prompts (unless early access is enabled in the KV store). It compares each dot-segment numerically, so `1.32.100 > 1.32.2` works correctly.
- Keep fork-only releases on a single upstream-patch base to ≤ 99 (e.g. `1.32.100`–`1.32.199`) before the next upstream patch takes over the next block. You will never realistically hit this.
- The fork's in-app updater only ever queries the fork's own repo (`BigMoonTech/project-nomad-wsl` releases), so upstream's numbers never enter the comparison — this scheme is for human clarity and monotonicity, not for matching upstream.

---

## Part 3: Releasing a New Version (The Standard Workflow)

This is the playbook for shipping any new version, whether it's a tiny fix or a big feature merge.

### Step 1: Make and commit your code changes
Use Conventional Commits format:
```
feat(scope): add new thing
fix(scope): fix broken thing
chore(ci): tweak workflow
docs: update README
```

Push to `main` via GitHub Desktop.

### Step 2: Pick the new version number
- Look at the previous release tag on https://github.com/BigMoonTech/project-nomad-wsl/releases
- Bump appropriately (PATCH/MINOR/MAJOR per semver)

### Step 3: Build all three Docker images
**Go to:** https://github.com/BigMoonTech/project-nomad-wsl/actions

For each of these (in any order — they run in parallel):
1. **Build Primary Docker Image**
2. **Build Sidecar Updater Image**
3. **Build Disk Collector Image**

For each:
- Click the workflow name in the left sidebar
- Click the **"Run workflow"** dropdown (top right of the workflow runs list)
- **Use workflow from:** `Branch: main` (default)
- **Version:** type your new version, no `v` prefix (e.g., `1.32.1`)
- **Tag latest:** ✅ check this (unless it's a pre-release/RC)
- Click **Run workflow**

Wait for all three to go ✅ green. Each takes 3–5 minutes. They run in parallel.

### Step 4: Verify images published
Check these three URLs and confirm your new version appears:
- https://github.com/BigMoonTech/project-nomad-wsl/pkgs/container/project-nomad-wsl
- https://github.com/BigMoonTech/project-nomad-wsl/pkgs/container/project-nomad-wsl-sidecar-updater
- https://github.com/BigMoonTech/project-nomad-wsl/pkgs/container/project-nomad-wsl-disk-collector

Each should list your new version tag plus `latest` pointing to it.

### Step 5: Create the GitHub Release (THIS IS WHAT FLIPS THE UPDATE SWITCH)

**Without this step, the in-app update prompt will never appear, even though the new image is published.** The version checker queries the GitHub Releases API, not the container registry.

**Navigate:**
1. Go to https://github.com/BigMoonTech/project-nomad-wsl
2. In the right sidebar under **About**, click **Releases**
3. Click the green **"Draft a new release"** button (top right)

**Fill in the form:**

| Field | What to enter |
|-------|---------------|
| **Choose a tag** | Type the version with `v` prefix (e.g., `v1.32.1`). You'll see a "Create new tag: v1.32.1 on publish" option appear — click it. |
| **Target** | Leave as `main` (default) |
| **Previous tag** | Leave as `auto` (default) — GitHub picks the previous release |
| **Release title** | `v1.32.1` (or `v1.32.1 — <short summary>` if you want) |
| **Describe this release** | Use the template below |
| **Set as a pre-release** | ❌ **Unchecked** for normal releases. ✅ Check ONLY for RCs/betas (note: pre-releases won't trigger update prompts unless early access is enabled in KV store) |
| **Set as the latest release** | ✅ **Checked** for the version you want users to update to |
| **Create a discussion for this release** | Optional — leave unchecked unless you want to invite community discussion |

**Release notes template (paste into Description):**
```markdown
## v<VERSION>

<one-paragraph summary of what changed>

### Changes
- feat(scope): new thing
- fix(scope): bug fix
- chore: maintenance

### Upstream sync
This release includes upstream changes through v<UPSTREAM_VERSION>.
<list any notable upstream PRs by number>

### Install
See the [README](https://github.com/BigMoonTech/project-nomad-wsl#installation--quickstart) for fresh installs.

### Upgrade
Existing installs: open the admin panel → Settings → Check for Updates.
```

**Click `Publish release`.**

### Step 6: Verify the release is queryable
From any terminal (or browser):
```bash
curl -s https://api.github.com/repos/BigMoonTech/project-nomad-wsl/releases/latest | grep tag_name
```
Should return `"tag_name": "v1.32.1"`. If yes, the in-app updater will now see it.

### Step 7: Test the in-app update on your install
1. Open http://localhost:8080
2. Go to **Settings → System Updates** (or wherever the "Check for Updates" button is)
3. Should show: **Current: 1.32.0** → **Latest: 1.32.1** → **Update Available**
4. Click **Update**
5. Sidecar updater will:
   - Edit `/opt/project-nomad/compose.yml` image tag from `:latest` → `:v1.32.1`
   - Pull new images via `docker compose pull`
   - Recreate the admin container
6. Page will throw transient network errors during the ~30 sec restart — normal
7. Refresh, check Debug Info, confirm version shows `1.32.1`

You're done.

---

## Part 4: Syncing With Upstream (Pulling In Their Changes)

Upstream releases new features and fixes regularly. Here's how to bring them in.

### Step 1: Check what's available
From the main repo path (NOT a worktree):
```bash
cd /path/to/project-nomad-wsl
git fetch upstream
git log --oneline main..upstream/main
```

This shows commits in upstream that aren't in your fork. Read the commit messages to see what's coming.

### Step 2: See what files conflict
```bash
git log --name-only --oneline main..upstream/main | grep -E "^(install/|admin/app/services/|.github/workflows/|Dockerfile|package.json)" | sort -u
```

This lists files upstream changed that overlap with our fork's changes. Common conflict areas:
- `package.json` — version bumps from both sides
- `admin/app/services/system_service.ts` — if upstream changed near our GitHub API URL
- `Dockerfile` — if upstream changed labels or the version.json line
- `install/management_compose.yaml` — if upstream changed image versions

### Step 3: Merge
```bash
git checkout main
git merge upstream/main --no-commit --no-ff
```

Git will auto-merge what it can and stop on conflicts.

### Step 4: Resolve conflicts
For each file with `<<<<<<<` markers:
- **`package.json`**: Set the new fork version per the Versioning Rule in Part 2 (merging upstream `.Z` → `.Z00`; merging a new upstream minor `.0` → `.001`)
- **`system_service.ts`**: Keep our `BigMoonTech/project-nomad-wsl` URLs, take their other changes
- **`Dockerfile`**: Keep our BigMoonTech labels, take any other upstream changes
- **`install/management_compose.yaml`**: Keep our `ghcr.io/bigmoontech/*` image refs
- **Workflow files**: Keep our changes (no auth check, GHCR paths)
- **README.md**: Keep our "Unofficial Fork" banner at the top
- **Cherry-picked PRs that are now in upstream**: Take upstream's version

After resolving each file:
```bash
git add <file>
```

### Step 5: Verify our customizations survived
```bash
grep -l "ghcr.io/crosstalk-solutions" .github/workflows/*.yml install/management_compose.yaml
```
Should return nothing (no files match).

```bash
grep "BigMoonTech\|bigmoontech" admin/app/services/system_service.ts install/management_compose.yaml install/install_nomad.sh
```
Should show our customizations intact.

### Step 6: Commit and push
```bash
git commit -m "chore: merge upstream v<X.Y.Z> (N commits) and bump to <NEW_VERSION>"
git push origin main
```

### Step 7: Now follow Part 3 (release a new version)
Trigger the three image builds, create a GitHub release, test the update flow.

---

## Part 5: Cherry-Picking a Single Upstream PR

When upstream has a specific fix you want NOW (without waiting to sync everything):

```bash
git fetch upstream pull/<PR_NUMBER>/head:pr-<PR_NUMBER>
git log pr-<PR_NUMBER> --oneline -5
git cherry-pick <commit_hash>
git push origin main
```

Then follow Part 3 (release) if you want it deployed to your install.

---

## Part 6: Troubleshooting

### "Update Available" doesn't show in admin panel even though the image is built
- **Cause:** No GitHub Release exists for the new version
- **Fix:** Create the GitHub Release (Part 3, Step 5). The version checker queries `/releases/latest`, not the container registry.

### Image build fails with `denied: permission_denied: write_package`
- **Cause:** Repo's package permissions not enabled
- **Fix:** GitHub repo → Settings → Actions → General → Workflow permissions → "Read and write permissions" → Save

### `nvidia-smi` not found in WSL2
- **Cause:** NVIDIA Windows driver missing or too old
- **Fix:** Install driver 525.60.13+ from nvidia.com (not the Linux driver). Restart Windows.

### Update fails with "image not found"
- **Cause:** Either the new image hasn't been built/pushed yet, or the image tag in compose.yml doesn't match
- **Fix:** Verify the image is published (Part 3, Step 4). Check `/opt/project-nomad/compose.yml` references `ghcr.io/bigmoontech/project-nomad-wsl:latest`. Run `sudo docker compose -p project-nomad -f /opt/project-nomad/compose.yml pull` manually to see the actual error.

### Merge with upstream produces tons of conflicts in service files
- **Cause:** Cherry-picked PRs that are now officially merged upstream
- **Fix:** Take upstream's version (`git checkout --theirs <file>`) — they have the same content as your cherry-pick anyway

### Disk usage looked wrong on WSL2 — FIXED in v1.32.101
- **Symptom (pre-fix):** the System → Storage panel showed Docker Desktop's internal disk (an `overlay` reading near the ~1 TB Docker-VM ceiling), not the disk NOMAD's content lives on.
- **Root cause:** the disk-collector runs *inside Docker Desktop's own utility VM* (`docker-desktop`), so through its `/:/host` mount it only sees that VM's virtual disks — never the user's real storage. The actual NOMAD data lives on the WSL distro's own virtual disk, and the physical drive arrives only as a `9p` mount, which the admin's `type === 'disk'` block-device filter dropped. The disk-collector itself is **unchanged** — it still only sees Docker's VM.
- **Fix (admin-side):** `getSystemInfo` now detects WSL2 from the kernel tag (`microsoft-standard-WSL2`) and, on WSL2, builds the Storage panel from the filesystem backing `/app/storage` — the WSL VM disk where content actually lives — instead of the collector's disk list. Helpers: `admin/app/utils/wsl_disk.ts` (`isWsl2Kernel`, `buildWsl2StorageDisk`), wired in `system_service.ts`. Native Linux is unchanged.
- **Verify:** System → Storage shows a single **NOMAD Storage** device at the WSL disk's real usage (e.g. ~408 GB / ~1006 GB). Raw data: `docker exec nomad_admin df -Pk /app/storage`.
- **Known limitation:** the panel reports the WSL virtual disk (and its ~1 TB default ceiling), not the underlying physical drive — which physical drive backs the VM isn't reliably knowable from inside a container.

### Container starts but localhost:8080 shows nothing
- **Cause:** Admin container is still initializing (migrations + manifest reconciliation can take 30–60 seconds)
- **Fix:** Wait. Check `docker logs nomad_admin --tail 30` to see startup progress. Look for "RECONCILING FILESYSTEM MANIFESTS" — once it completes, the HTTP server will be live.

### `git commit` fails with "Unable to create index.lock"
- **Cause:** Stale git lock file (common on Windows network shares)
- **Fix:** `rm -f /path/to/.git/index.lock` and retry

---

## Part 7: Quick Reference

### URLs You'll Use
- **Repo:** https://github.com/BigMoonTech/project-nomad-wsl
- **Actions:** https://github.com/BigMoonTech/project-nomad-wsl/actions
- **Releases:** https://github.com/BigMoonTech/project-nomad-wsl/releases
- **New release:** https://github.com/BigMoonTech/project-nomad-wsl/releases/new
- **Packages:** https://github.com/BigMoonTech/project-nomad-wsl/packages
- **Issues:** https://github.com/BigMoonTech/project-nomad-wsl/issues
- **Upstream:** https://github.com/Crosstalk-Solutions/project-nomad
- **Local install:** http://localhost:8080

### Useful Commands
```bash
# Quick health check on your running install
docker ps --filter "name=nomad_"

# Tail admin logs
docker logs nomad_admin --tail 50 -f

# Manual update (bypasses in-app updater)
sudo bash /opt/project-nomad/update_nomad.sh

# Check Ollama GPU access from inside the container
docker exec nomad_ollama nvidia-smi

# Force-refresh compose to pull latest images
sudo docker compose -p project-nomad -f /opt/project-nomad/compose.yml pull
sudo docker compose -p project-nomad -f /opt/project-nomad/compose.yml up -d --force-recreate

# See what's behind in upstream
cd /path/to/project-nomad-wsl
git fetch upstream
git log --oneline main..upstream/main
```

### The Mental Model
```
┌──────────────────────────────────────────────────────────┐
│  YOU make code changes, push to main                     │
│                  │                                        │
│                  ▼                                        │
│  TRIGGER 3 build workflows on Actions                    │
│  (with VERSION input matching your intended release tag) │
│                  │                                        │
│                  ▼                                        │
│  Images published to ghcr.io/bigmoontech/*               │
│                  │                                        │
│                  ▼                                        │
│  CREATE a GitHub Release with matching tag (vX.Y.Z)      │
│  ← This is what makes the in-app update prompt appear ←  │
│                  │                                        │
│                  ▼                                        │
│  Your running install: Settings → Check for Updates      │
│                  │                                        │
│                  ▼                                        │
│  Click Update → sidecar pulls new image → containers     │
│                  recreate → version bumps                │
└──────────────────────────────────────────────────────────┘
```

That's the whole loop. Once you've done it once, every future release is the same six clicks.

---

## Part 8: Fork Change Inventory

The complete set of changes that distinguish this fork from upstream. Useful when auditing what might conflict during an upstream sync, or when onboarding to the fork's architecture.

1. **CLAUDE.md** — onboarding doc for Claude Code sessions working in the repo
2. **Install script WSL2 detection** — `grep -qi microsoft /proc/version` gate; conditional Docker checks (skip `systemctl`), conditional GPU setup (skip `nvidia-container-toolkit`, verify Docker Desktop runtime instead)
3. **Windows install guide** — `install/windows/README.md` with prerequisites, GPU verification, and install command
4. **Disk-collector mount adjustment** — install script rewrites `/:/host:ro,rslave` → `/:/host:ro` on WSL2 (`rslave` propagation isn't supported there; the flag prevents the container from starting at all). The sidecar is kept, not removed. Upstream addresses the same root issue differently — by having the user set `mount --make-rshared /` in `wsl.conf`. Whether disk *figures* report correctly on WSL2 with the plain-`ro` approach was a separate concern, resolved in v1.32.101 (see Part 6). Full rationale in Part 9.
5. **CI pipeline** — all three build workflows publish to `ghcr.io/bigmoontech/*` and drop upstream's `DEPLOYMENT_AUTHORIZED_USERS` auth check
6. **Sidecar updater** — `sed` pattern in `update-watcher.sh` matches the fork's image paths during in-app updates
7. **Update flow** — `system_service.ts` GitHub API URLs point to the fork's releases
8. **Fork identity** — README "Unofficial Fork" banner, Dockerfile OCI labels, support page, debug modal, FAQ routing, issue templates
9. **Versioning scheme** — fork-specific patch numbering (Part 2) to avoid collisions with upstream releases

### Hardware notes
- GPU passthrough on WSL2 is handled entirely by Docker Desktop + the NVIDIA Windows driver (525.60.13+); confirmed working with NVIDIA discrete GPUs.
- `.wslconfig` (RAM / CPU / swap) is tuned per-machine on the host and is not part of the repo.

---

## Part 9: WSL2 Disk-Collector Mount Handling

### Summary

On WSL2 the install script rewrites the disk-collector sidecar's host bind mount from `/:/host:ro,rslave` to `/:/host:ro`. This is the fork's equivalent of the manual `wsl.conf` + `mount --make-rshared /` step documented in the upstream community WSL2 guide. Both achieve the same result — the sidecar starts and collects host disk information — but the fork performs the adjustment automatically in the installer rather than requiring host reconfiguration.

### Why `rslave` fails on WSL2

The disk-collector reads host block-device and filesystem information through a bind mount, `/:/host`, declared in `management_compose.yaml` as `ro,rslave`. The `rslave` flag enables slave mount propagation so that filesystems mounted on the host after the container starts remain visible inside it. This is the conventional pattern for host-introspection sidecars (Prometheus node-exporter uses the same approach) and is correct on standard Linux hosts.

`rslave` requires the host root (`/`) to be a shared or slave mount. WSL2 mounts `/` as a private mount by default, so the bind mount is invalid and the container fails to start. Docker reports:

```
docker: Error response from daemon: path / is mounted on / but it is not a shared or slave mount.
```

### The two approaches

- **Upstream (community WSL2 guide):** the operator reconfigures WSL. `/etc/wsl.conf` is set to enable systemd and run `mount --make-rshared /` at boot, followed by `wsl --shutdown`. This makes `/` a shared mount so `rslave` becomes valid. **Scope nuance:** `/etc/wsl.conf` is *per-distribution* (it lives inside the distro), not the Windows-host-global `.wslconfig` — so the change is distribution-scoped, not literally system-wide across Windows, and a user could even isolate NOMAD in a dedicated distro to contain it. It is still an edit to that distribution's system config: it enables systemd and flips `/`'s mount propagation for everything in that distribution, requires a full `wsl --shutdown`, and persists until manually removed (upstream's uninstaller does not revert it). The live `mount --make-rshared /` does not persist across `wsl --shutdown` on its own — the `wsl.conf` `command=` line re-applies it each boot.
- **This fork (install script):** WSL2 is detected via `grep -qi microsoft /proc/version`, and the sidecar's own mount is rewritten to `/:/host:ro` (`install/install_nomad.sh`). A read-only bind mount carries no shared/slave requirement and starts with no changes to the host. `rslave` only provided visibility of mounts added *after* container start; on a WSL2 desktop nothing hot-plugs into the VM that way, and all filesystems present at start are already visible. The single trade-off — no auto-visibility of later hot-plugged drives — is irrelevant for this environment.

### Why the install-script approach is preferred here

- The platform adaptation belongs in the application's installer, not in a list of manual host edits. The software conforms to the platform; the platform is not reconfigured to suit one container.
- The change is scoped to NOMAD's own container rather than altering mount propagation for the entire WSL distribution.
- Under Docker Desktop — the supported Windows runtime — the engine, and therefore the `/host` mount, resolves against Docker's own utility VM (`docker-desktop`), not the operator's distribution. A `mount --make-rshared /` applied to the distribution root does not govern the filesystem the bind mount actually resolves against, so the plain-`ro` rewrite is the correct lever for Docker Desktop specifically.

### Support scope

On Windows, this fork **requires** Docker Desktop with WSL2 integration as the supported container runtime. Docker Desktop manages WSL2 integration and NVIDIA GPU passthrough through the Windows driver and is actively maintained; standardizing on a single, well-understood runtime keeps the install path reliable and testable. Native-Docker-in-WSL and other runtimes are out of scope for this fork.

### Related

This concerns only whether the disk-collector *starts* and reads data. The separate question of whether the resulting disk *figures* are presented correctly in the System → Storage Devices panel on WSL2 has since been **resolved in v1.32.101** (see Part 6).
