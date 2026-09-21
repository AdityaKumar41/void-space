#!/usr/bin/env bash
# Entrypoint for the optional Blender runner container (FR-6.3).
# Usage: blender-entrypoint.sh --input /jobs/in.blend --output /jobs/out.glb [--budget 50000]
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: blender-entrypoint.sh --input <file> --output <file> [--budget N] [--format glb]" >&2
  exit 2
fi

exec blender --background --factory-startup --python /opt/void-space/blender-optimize.py -- "$@"
