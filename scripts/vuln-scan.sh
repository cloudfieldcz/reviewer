#!/bin/sh
# Vulnerability scan. With SGW_TOKEN and `shdg` on PATH it uploads an SBOM to the Shieldoo Gate
# (project `reviewer`); without them it falls back to `npm audit`.
#   scripts/vuln-scan.sh                      # source tree (package-lock.json) → component `app`
#   scripts/vuln-scan.sh ghcr.io/…/reviewer:x # a built image (OS layer too)  → component `image`
set -eu
cd "$(dirname "$0")/.."

if [ -z "${SGW_TOKEN:-}" ] || ! command -v shdg >/dev/null 2>&1; then
  echo "SGW_TOKEN or shdg missing — running npm audit instead" >&2
  exec npm audit
fi

export SHIELDOO_URL=${SHIELDOO_URL:-https://${SGW_HOST:-shieldoo-gate.cloudfield.cz}}
export SHIELDOO_TOKEN=$SGW_TOKEN
mkdir -p docs/vulnerabilities

if [ $# -gt 0 ]; then
  exec shdg scan --project reviewer --component image --image "$1" --ecosystem docker \
    --sbom-output docs/vulnerabilities/sbom-image.cdx.json --wait --timeout 20m
fi
exec shdg scan --project reviewer --component app --dir . --ecosystem npm \
  --skip-dirs node_modules,dist,.astro,data \
  --sbom-output docs/vulnerabilities/sbom-app.cdx.json --wait --timeout 10m
