#!/usr/bin/env bash
# Rolls Reviewer out to a Docker host over SSH – an Azure VM, a NAS, anything with Docker and the
# compose plugin. Copies deploy/docker-compose.yaml and deploy/.env to ~/reviewer on the host,
# pulls the images and (re)creates the containers. Data stays in the `reviewer-data` volume.
#
#   SSH_TARGET=azureuser@reviewer.example.com deploy/deploy.sh
#
# The image is ghcr.io/cloudfieldcz/reviewer:$REVIEWER_TAG from deploy/.env. For a branch or commit
# that has no published image, build it on the host from the public repository instead:
#
#   SSH_TARGET=… BUILD_REF=poc-static-sites deploy/deploy.sh
#
# Or ship an image built on this machine (`docker build -t reviewer:local .`), with no registry in
# between – the host must have the same CPU architecture:
#
#   SSH_TARGET=… LOCAL_IMAGE=reviewer:local deploy/deploy.sh
set -euo pipefail

: "${SSH_TARGET:?Set SSH_TARGET, e.g. azureuser@reviewer.example.com}"
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$HERE/.env" ] || { echo "deploy/.env is missing – see deploy/.env.example or deploy/azure/entra-app.sh" >&2; exit 1; }
REPO_URL=${REPO_URL:-https://github.com/cloudfieldcz/reviewer.git}
BUILD_REF=${BUILD_REF:-}
LOCAL_IMAGE=${LOCAL_IMAGE:-}
[ -z "$BUILD_REF" ] || [ -z "$LOCAL_IMAGE" ] || { echo "Set BUILD_REF or LOCAL_IMAGE, not both" >&2; exit 1; }

ssh "$SSH_TARGET" 'mkdir -p ~/reviewer && chmod 700 ~/reviewer'
scp -q "$HERE/docker-compose.yaml" "$HERE/.env" "$SSH_TARGET:reviewer/"

LOCAL_TAG=
if [ -n "$LOCAL_IMAGE" ]; then
  # Tagged by image id, so every shipped build is a distinct tag and compose recreates the container.
  LOCAL_TAG=local-$(docker image inspect "$LOCAL_IMAGE" --format '{{.Id}}' | cut -d: -f2 | cut -c1-12)
  docker tag "$LOCAL_IMAGE" "ghcr.io/cloudfieldcz/reviewer:$LOCAL_TAG"
  echo "Shipping $LOCAL_IMAGE as :$LOCAL_TAG …"
  docker save "ghcr.io/cloudfieldcz/reviewer:$LOCAL_TAG" | gzip | ssh "$SSH_TARGET" 'gunzip | docker load'
fi

# The remote script reads its arguments; nothing from this machine is expanded inside it.
ssh "$SSH_TARGET" bash -s -- "$REPO_URL" "$BUILD_REF" "$LOCAL_TAG" <<'REMOTE'
set -euo pipefail
repo_url=$1 build_ref=${2:-} local_tag=${3:-}
cd ~/reviewer
chmod 600 .env
if [ -n "$local_tag" ]; then
  sed -i "s/^REVIEWER_TAG=.*/REVIEWER_TAG=$local_tag/" .env
  grep -q '^REVIEWER_TAG=' .env || echo "REVIEWER_TAG=$local_tag" >> .env
  docker compose pull --quiet traefik redis oauth2-reviewer
elif [ -n "$build_ref" ]; then
  tag=$(printf '%s' "$build_ref" | tr -c 'A-Za-z0-9_.-' '-')
  docker build --pull -t "ghcr.io/cloudfieldcz/reviewer:$tag" "$repo_url#$build_ref"
  sed -i "s/^REVIEWER_TAG=.*/REVIEWER_TAG=$tag/" .env
  grep -q '^REVIEWER_TAG=' .env || echo "REVIEWER_TAG=$tag" >> .env
  docker compose pull --quiet traefik redis oauth2-reviewer
else
  docker compose pull --quiet
fi
docker compose up -d --remove-orphans
for _ in $(seq 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' reviewer 2>/dev/null)" = healthy ] && break
  sleep 2
done
docker compose ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'
docker image prune -f >/dev/null
REMOTE

echo "Deployed: https://$(grep -E '^REVIEWER_HOST=' "$HERE/.env" | cut -d= -f2-)/"
