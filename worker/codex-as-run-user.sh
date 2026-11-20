#!/bin/sh
# Codex, started as the run's own Unix user: the SDK runs this instead of the binary (codexPathOverride).
# The worker runs as root to be able to switch users; agents never do: no capabilities, no extra groups.
set -eu
[ -n "${DYON_RUN_UID:-}" ] || { echo "DYON_RUN_UID is not set" >&2; exit 1; }
export PATH="/opt/codex/path:$PATH"
exec setpriv --reuid="$DYON_RUN_UID" --regid="$DYON_RUN_UID" --clear-groups --inh-caps=-all --bounding-set=-all /opt/codex/codex "$@"
