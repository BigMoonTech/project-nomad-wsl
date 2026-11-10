#!/usr/bin/env bash
# Exercise the production entrypoint and schema migrations on disposable Compose volumes.
set -euo pipefail

fixture=$(mktemp -d)
project="nomad-smoke-${fixture##*.}"
project=${project,,}
compose=(docker compose -p "$project" -f "$fixture/compose.json")
cleanup() {
  if [[ -f "$fixture/compose.json" ]]; then
    if [[ $1 != 0 ]]; then "${compose[@]}" logs --tail=80 admin mysql redis || true; fi
    "${compose[@]}" down -v
  fi
  rm -r "$fixture"
}
trap 'cleanup $?' EXIT

# Only these three services need to start to exercise migrations. Keep the DB,
# cache and storage across both boots and isolate names, volumes and host ports.
configure() {
  docker compose -f "$1" config --format json | jq --arg image "$2" '
    .services |= with_entries(select(.key == "admin" or .key == "mysql" or .key == "redis"))
    | .services[] |= del(.container_name)
    | .services.admin.image = $image
    | .services.admin.pull_policy = "missing"
    | .services.admin.ports = []
    | .services.admin.volumes = ["storage:/app/storage", "nomad-update-shared:/app/update-shared"]
    | .services.mysql.volumes = ["database:/var/lib/mysql"]
    | .services.redis.volumes = ["cache:/data"]
    | .services.admin.environment += {APP_KEY:"test-only-000000000000000000000000", DB_PASSWORD:"test", URL:"http://localhost:8080"}
    | .services.mysql.environment += {MYSQL_PASSWORD:"test", MYSQL_ROOT_PASSWORD:"test-root"}
    | .volumes = {storage:{}, database:{}, cache:{}, "nomad-update-shared":{}}
    | del(.name, .networks)
    | .services[] |= del(.networks)
  ' > "$fixture/compose.json"
}

boot() {
  "${compose[@]}" up --wait --wait-timeout 240 -d
  "${compose[@]}" exec -T admin curl -fsS http://localhost:8080/api/health | jq -e '.status == "ok"'
}

if [[ $(uname -m) == x86_64 ]]; then
  # Use the compose template and published admin that existing WSL2 users have.
  git show v1.32.101:install/management_compose.yaml > "$fixture/previous.yml"
  configure "$fixture/previous.yml" ghcr.io/bigmoontech/project-nomad-wsl:v1.32.101
  boot
  "${compose[@]}" exec -T mysql mysql -unomad_user -ptest nomad \
    -e "INSERT INTO kv_store (\`key\`, value) VALUES ('smoke.upgrade', 'persisted')"
fi

configure install/management_compose.yaml nomad-admin:ci
boot
if [[ $(uname -m) == x86_64 ]]; then
  value=$("${compose[@]}" exec -T mysql mysql -unomad_user -ptest -Ns nomad \
    -e "SELECT value FROM kv_store WHERE \`key\` = 'smoke.upgrade'")
  [[ "$value" == persisted ]]
fi
