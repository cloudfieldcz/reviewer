#!/usr/bin/env bash
# Copies Reviewer's data (the SQLite database and the uploaded sites) from a Docker host to a local
# tar.gz, or puts such an archive back. Together with deploy/.env this is everything a move to
# another host needs: deploy there, restore, point DNS at it.
#
#   SSH_TARGET=azureuser@reviewer.example.com deploy/backup.sh                   # → reviewer-data-<date>.tar.gz
#   SSH_TARGET=admin@nas.example.com deploy/backup.sh restore reviewer-data-….tar.gz
#
# The app is stopped for the few seconds the copy takes, so the database file is consistent.
# Restore replaces whatever the volume holds.
set -euo pipefail

: "${SSH_TARGET:?Set SSH_TARGET, e.g. azureuser@reviewer.example.com}"
VOLUME=${VOLUME:-reviewer_reviewer-data}   # compose project "reviewer" (the ~/reviewer folder) + volume name
HELPER=${HELPER_IMAGE:-redis:7-alpine}     # any image with tar that the host already has

case ${1:-backup} in
  backup)
    out=${2:-reviewer-data-$(date +%Y%m%d-%H%M%S).tar.gz}
    ssh "$SSH_TARGET" "docker stop reviewer >/dev/null && trap 'docker start reviewer >/dev/null' EXIT && \
      docker run --rm -v $VOLUME:/data:ro --entrypoint tar $HELPER -C /data -czf - ." > "$out"
    echo "Saved $out ($(du -h "$out" | cut -f1))"
    ;;
  restore)
    in=${2:?Usage: backup.sh restore <archive.tar.gz>}
    ssh "$SSH_TARGET" "docker stop reviewer >/dev/null && trap 'docker start reviewer >/dev/null' EXIT && \
      docker run --rm -i -v $VOLUME:/data --entrypoint sh $HELPER -c 'find /data -mindepth 1 -delete && tar -C /data -xzf -'" < "$in"
    echo "Restored $in into $VOLUME on $SSH_TARGET"
    ;;
  *)
    echo "Usage: backup.sh [backup [file] | restore <file>]" >&2
    exit 1
    ;;
esac
