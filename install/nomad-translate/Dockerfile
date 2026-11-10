# Both builds expose the same Bergamot Python API to the translation proxy.
FROM python:3.10-slim-bookworm AS wheel-amd64
RUN pip wheel --no-deps --only-binary=:all: --wheel-dir=/wheels bergamot==0.4.5

FROM python:3.10-slim-bookworm AS wheel-arm64
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git libpcre2-dev libopenblas-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# This revision of Marian uses the ruy kernels on ARM. Target baseline ARMv8-A
# so wheels built on a CI runner also run on the GB10 and other ARM64 CPUs.
ARG BERGAMOT_REV=9271618ebbdc5d21ac4dc4df9e72beb7ce644774
WORKDIR /src
RUN git init -q && git fetch -q --depth 1 https://github.com/browsermt/bergamot-translator "$BERGAMOT_REV" \
    && git checkout -q FETCH_HEAD \
    && git submodule update --init --recursive --depth 1 --jobs 4 -- \
       3rd_party/marian-dev 3rd_party/pybind11 3rd_party/ssplit-cpp
ARG BUILD_JOBS=3
RUN BUILD_ARCH=armv8-a CMAKE_BUILD_PARALLEL_LEVEL="$BUILD_JOBS" \
    CMAKE_ARGS="-DGIT_SUBMODULE=OFF -DCOMPILE_CUDA=OFF -DUSE_MKL=OFF -DSSPLIT_USE_INTERNAL_PCRE2=OFF" \
    pip wheel -v --no-deps --wheel-dir=/wheels .

FROM wheel-${TARGETARCH} AS wheels

FROM python:3.10-slim-bookworm
ARG TARGETARCH
RUN if [ "$TARGETARCH" = arm64 ]; then \
      apt-get update && apt-get install -y --no-install-recommends libpcre2-8-0 libopenblas0-pthread libgomp1 && rm -rf /var/lib/apt/lists/*; \
    fi
# The Python CLI wrapper fetches third-party model catalogs on import. The proxy
# already manages its models, so load the wheel's native extension directly.
ENV PYTHONPATH=/usr/local/lib/python3.10/site-packages/bergamot
RUN --network=none --mount=from=wheels,source=/wheels,target=/wheels \
    pip install --no-index --no-deps /wheels/*.whl && python -c 'from _bergamot import Service, ServiceConfig'

WORKDIR /app
COPY blocks.py proxy.py fetch_models.py entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh

# Models are a mounted volume, not baked in: at ~37 MB per direction the image
# would balloon, and which languages a user wants is not knowable at build time.
ENV MODELS=/models \
    KIWIX=http://nomad_kiwix_server:8080 \
    PORT=8391 \
    WORKERS=8 \
    TRANSLATE_LANGS=fr,es,de

EXPOSE 8391

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8391/viewer', timeout=4).status==200 else 1)"

ENTRYPOINT ["/app/entrypoint.sh"]
