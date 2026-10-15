#!/bin/sh
# `npm ci` through the Shieldoo Gate when SGW_TOKEN is set, straight from registry.npmjs.org otherwise.
# Install only: run `npm install <pkg>` without the gate, so package-lock.json keeps upstream URLs.
set -eu
cd "$(dirname "$0")/.."

if [ -z "${SGW_TOKEN:-}" ]; then
  echo "SGW_TOKEN not set — installing from registry.npmjs.org" >&2
  exec npm ci "$@"
fi

host=${SGW_HOST:-shieldoo-gate.cloudfield.cz}
auth=$(printf '%s:%s' "${SGW_USER:-reviewer}" "$SGW_TOKEN" | base64 | tr -d '\n')
cfg=$(mktemp)
trap 'rm -f "$cfg"' EXIT
chmod 600 "$cfg"
printf 'registry=https://npm.%s/\n//npm.%s/:_auth=%s\n' "$host" "$host" "$auth" > "$cfg"

echo "Shieldoo Gate: ON (npm.$host, project ${SGW_USER:-reviewer})" >&2
npm ci --userconfig "$cfg" "$@"
