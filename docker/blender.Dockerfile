# ---------------------------------------------------------------------------
# Headless Blender runner (FR-6.3) — OPTIONAL compose profile.
#
# This image is deliberately not part of `pnpm dev:up`: it is large. It is used
# only by the `blender-runner` service (profile "blender") when a
# blender-optimize job needs to convert/optimise a .blend source.
# ---------------------------------------------------------------------------
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV BLENDER_JOB_DIR=/jobs

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    blender \
    python3 \
    ca-certificates \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/void-space
COPY docker/scripts/blender-optimize.py /opt/void-space/blender-optimize.py
COPY docker/scripts/blender-entrypoint.sh /opt/void-space/blender-entrypoint.sh
RUN chmod +x /opt/void-space/blender-entrypoint.sh \
  && mkdir -p /jobs \
  && useradd --system --create-home --uid 10001 blender \
  && chown -R blender:blender /opt/void-space /jobs

USER blender
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/void-space/blender-entrypoint.sh"]
