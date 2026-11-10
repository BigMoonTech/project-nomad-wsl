FROM node:24-bookworm-slim AS base

# Install bash & curl for entrypoint script compatibility, graphicsmagick for pdf2pic, and vips-dev & build-base for sharp 
RUN apt-get update && apt-get install -y \
      bash \
      curl \
      openssl \
      graphicsmagick \
      libvips-dev \
      build-essential \
      pciutils \
      && rm -rf /var/lib/apt/lists/*

# @openzim/libzim 4.0.0 needs the matching 9.4.0 headers and shared library.
# Resume interrupted downloads and verify the archive before npm builds the binding.
FROM base AS libzim
ARG TARGETARCH
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) arch=x86_64; digest=4a755fcdbfb17f3421b5adf3b5e23c50c7e3f7ae05fa38df71f2d0c44f8feed3 ;; \
      arm64) arch=aarch64-manylinux; digest=28eaf5a52e6d800c0ca9e215b8ad63e0805a4c98768f9a4134a38ff311b79400 ;; \
      *) exit 1 ;; \
    esac; \
    mkdir /archives; cd /archives; file="libzim_linux-${arch}-9.4.0.tar.gz"; \
    for attempt in 1 2 3 4 5; do \
      curl -fSL --connect-timeout 15 --speed-limit 512 --speed-time 30 -C - -o "$file" \
        "https://download.openzim.org/release/libzim/$file" && break; \
    done; \
    echo "$digest  $file" | sha256sum -c -

# All deps stage
FROM base AS deps
WORKDIR /app
ADD admin/package.json admin/package-lock.json ./
# The package installer skips its network fetch when the archive already exists.
# Use the base image’s matching Node headers for concurrent native addon builds.
RUN --mount=type=bind,from=libzim,source=/archives,target=/archives \
    npm ci --ignore-scripts \
    && dest=node_modules/@openzim/libzim/download \
    && mkdir -p "$dest" \
    && cp /archives/*.tar.gz "$dest/" \
    && tar -xzf /archives/*.tar.gz --strip-components=1 -C "$dest" \
    && npm_config_nodedir=/usr/local npm rebuild \
    && rm "$dest"/*.tar.gz

FROM deps AS production-deps
RUN npm prune --omit=dev --ignore-scripts

# Build stage
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
ADD admin/ ./
# Regenerate the curated drug-reference data modules
# (app/data/{conditions,natural_remedies,home_remedies}.ts) from their single
# source of truth — the repo-root collections/*.json — so the JSON is what gets
# compiled into the image and the committed .ts can never silently drift from it
# in a build. The gen script resolves ../../collections relative to admin/scripts,
# which is /collections once admin/ has been copied to /app.
COPY collections/ /collections/
RUN npm run gen:curated-data
RUN node ace build

# Production stage
FROM base
ARG VERSION=dev
ARG BUILD_DATE
ARG VCS_REF
ARG TARGETARCH

# go-pmtiles (regional map extracts). Pinned so the CLI's stdout format stays
# in sync with parseDryRunOutput().
ARG PMTILES_VERSION=1.30.2
# Upstream releases don't ship a checksums file, so pin per-arch SHA256 here.
# When bumping PMTILES_VERSION, regenerate these with:
#   curl -fsSL <release-url> | sha256sum
ARG PMTILES_SHA256_AMD64=2cd3aa18868297fc88425038f794efdc0995e0275f4ca16fa496dd79e245a40c
ARG PMTILES_SHA256_ARM64=804cdf071834e1156af554c1a26cc42b56b9cde5a2db9c6e3653d16fb846d5fa
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) PMTILES_ARCH=x86_64; PMTILES_SHA256="${PMTILES_SHA256_AMD64}" ;; \
      arm64) PMTILES_ARCH=arm64;  PMTILES_SHA256="${PMTILES_SHA256_ARM64}" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    TARBALL="go-pmtiles_${PMTILES_VERSION}_Linux_${PMTILES_ARCH}.tar.gz"; \
    cd /tmp; \
    curl -fsSL -o "$TARBALL" \
      "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/${TARBALL}"; \
    echo "${PMTILES_SHA256}  ${TARBALL}" | sha256sum -c -; \
    tar -xzf "$TARBALL" -C /usr/local/bin pmtiles; \
    rm -f "$TARBALL"; \
    chmod +x /usr/local/bin/pmtiles; \
    /usr/local/bin/pmtiles version

# Labels
LABEL org.opencontainers.image.title="Project NOMAD (BigMoonTech fork)" \
      org.opencontainers.image.description="Project NOMAD for Windows/WSL2 and native ARM64 Linux. Fork of Crosstalk Solutions' Project N.O.M.A.D." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.vendor="BigMoonTech" \
      org.opencontainers.image.authors="BigMoonTech" \
      org.opencontainers.image.documentation="https://github.com/BigMoonTech/project-nomad-wsl/blob/main/README.md" \
      org.opencontainers.image.source="https://github.com/BigMoonTech/project-nomad-wsl" \
      org.opencontainers.image.url="https://github.com/BigMoonTech/project-nomad-wsl" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production

# Creator Packs entitlement key, injected into OFFICIAL release builds at build
# time (--build-arg CREATOR_PACKS_APP_KEY=... from the CREATOR_PACKS_APP_KEY CI
# secret; see build-primary-image.yml). Baked as an ENV so admin/start/env.ts
# reads it at runtime. Empty by default, so builds from source (and any build
# without the secret) ship UNCONFIGURED and hide the Creator Packs UI. The key
# lands in this public image layer (extractable — the accepted ceiling); rotate
# via `wrangler secret put APP_KEY` + a new image if it leaks.
ARG CREATOR_PACKS_APP_KEY=""
ENV CREATOR_PACKS_APP_KEY=$CREATOR_PACKS_APP_KEY

WORKDIR /app
COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=build /app/build /app
# Generate version.json from the VERSION build-arg so the image tag is the
# single source of truth (previously copied root package.json, which drifted
# from the tag when semantic-release did not commit the bump back).
RUN echo "{\"version\":\"${VERSION}\"}" > /app/version.json

# Copy docs and README for access within the container
COPY admin/docs /app/docs
COPY README.md /app/README.md

# Empty Calibre library, seeded into storage/books on Calibre-Web install
# (see DockerService._runPreinstallActions__CalibreWeb)
COPY install/calibre-empty-library/metadata.db /app/assets/calibre/metadata.db

# Copy entrypoint script and ensure it's executable
COPY install/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]