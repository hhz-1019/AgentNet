#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
batch="${1:?Final backup batch required}"
[[ "$batch" =~ ^hk-cutover-[0-9]{14}$ ]] || exit 2
root="/srv/elsewhere/releases/$batch"
backup="/srv/elsewhere/backups/$batch"
mountpoint -q /srv/elsewhere
grep -qx FINAL_RESTORE_AND_ALL_PG_ROW_FINGERPRINTS_MATCH "$root/evidence/restore-result.txt"
test -f "$backup/source-freeze-confirmed.json"
test ! -e "$root/new-writes-started-at"
docker run --rm --network none --mount "type=bind,src=$root,dst=/release" node:22-alpine node -e '
const fs=require("fs"),p="/release/compose.json",j=JSON.parse(fs.readFileSync(p));
if(!j.services.core.networks.includes("edge"))j.services.core.networks.push("edge");
fs.writeFileSync(p,JSON.stringify(j,null,2));'
docker compose -f "$root/compose.json" config --quiet
# From this marker onward rollback requires copying new writes back first.
date -u +%FT%TZ > "$root/new-writes-started-at"
docker compose -f "$root/compose.json" up -d --wait --wait-timeout 300 > "$root/evidence/production-start.log" 2>&1
docker exec elsewhere-core curl -fsS --max-time 10 http://127.0.0.1:8080/api/v1/website/stats > "$root/evidence/production-website-stats.json"
docker exec elsewhere-web wget -q -O /dev/null http://127.0.0.1:8080/
docker network inspect elsewhere-edge-app --format '{{range .Containers}}{{.Name}}{{println}}{{end}}' | grep -qx elsewhere-edge || docker network connect elsewhere-edge-app elsewhere-edge
docker cp /srv/elsewhere/backups/Caddyfile.hk elsewhere-edge:/tmp/Caddyfile.hk
docker exec elsewhere-edge caddy validate --config /tmp/Caddyfile.hk --adapter caddyfile > "$root/evidence/edge-validate.log" 2>&1
cp /srv/elsewhere/edge/Caddyfile "$root/evidence/Caddyfile-before"
cp /srv/elsewhere/backups/Caddyfile.hk /srv/elsewhere/edge/Caddyfile
docker exec elsewhere-edge caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile > "$root/evidence/edge-reload.log" 2>&1
curl -fsS --max-time 15 --resolve elsewhere.twintalk.cn:443:127.0.0.1 https://elsewhere.twintalk.cn/api/v1/website/stats > "$root/evidence/public-website-stats.json"
curl -fsS --max-time 15 --resolve elsewhere.twintalk.cn:443:127.0.0.1 -o /dev/null https://elsewhere.twintalk.cn/dashboard/settings
test ! -e /srv/elsewhere/current
ln -s "$root" /srv/elsewhere/current
mv "$root/NOT_LIVE" "$root/ACTIVATED"
date -u +%FT%TZ > "$root/activated-at"
echo 'HONG_KONG_PRODUCTION_ACTIVATED' | tee "$root/evidence/activation-result.txt"
