#!/usr/bin/env bash
set -euo pipefail
release_id=${1:?Usage: activate.sh RELEASE_ID}
[[ "$release_id" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 2
release_path="/opt/mario-web/releases/$release_id"
test -f "$release_path/server/index.mjs"
test -f "$release_path/dist/index.html"
health_file=$(mktemp /run/mario-web-health.XXXXXX)
trap 'rm -f "$health_file"' EXIT
if curl --silent --fail http://127.0.0.1:2678/api/health >"$health_file"; then
  /opt/mario-web/runtime/bin/node --input-type=module -e '
    import {readFileSync} from "node:fs";
    const health=JSON.parse(readFileSync(process.argv[1],"utf8"));
    if(health.players>0){console.error("Active players detected; finish current games before deployment.");process.exit(1);}
  ' "$health_file"
fi
previous_release=$(readlink -f /opt/mario-web/current 2>/dev/null || true)
ln -s "$release_path" /opt/mario-web/current.next
mv -Tf /opt/mario-web/current.next /opt/mario-web/current
systemctl restart mario-web.service
healthy=false
for attempt in {1..15}; do
  if curl --silent --fail http://127.0.0.1:2678/api/health >/dev/null; then healthy=true; break; fi
  sleep 1
done
if [ "$healthy" != true ]; then
  if [ -n "$previous_release" ]; then
    ln -s "$previous_release" /opt/mario-web/current.next
    mv -Tf /opt/mario-web/current.next /opt/mario-web/current
    systemctl restart mario-web.service
  fi
  echo 'Mario service health check failed; previous release restored when available.' >&2
  exit 1
fi
echo "Mario release active: $release_id"
