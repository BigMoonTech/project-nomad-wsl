#!/usr/bin/env bash
# Exercise the installer branches without changing the machine running the tests.
set -eu
source install/install_nomad.sh
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
real_docker=$(command -v docker)

sudo() { echo "Unexpected host change: $*" >&2; exit 90; }
mock_engine='Ubuntu'
daemon_up=true
compose_up=true
runtime=yes
mock_socket=local
docker() {
  case "$*" in
    'info --format {{.OperatingSystem}}') $daemon_up && echo "$mock_engine" ;;
    'info --format {{.OSType}}') echo linux ;;
    'info --format {{.Architecture}}') echo aarch64 ;;
    'info --format {{.ID}}') echo local ;;
    '--host unix:///var/run/docker.sock info --format {{.ID}}') echo "$mock_socket" ;;
    'info --format {{if index .Runtimes "nvidia"}}yes{{end}}') echo "$runtime" ;;
    'compose version') "$compose_up" ;;
    'compose -f '*) "$real_docker" "$@" ;;
    *) echo "Unexpected docker command: $*" >&2; exit 91 ;;
  esac
}
expect_failure() {
  if ( "$@" ); then echo "Expected $* to fail" >&2; exit 1; fi
}
for test_arch in aarch64 arm64 amd64 x86_64; do
  uname() { echo "$test_arch"; }
  check_architecture
done
test_arch=armv7l
expect_failure check_architecture

IS_WSL=true
mock_engine='Docker Desktop'
ensure_docker_installed
check_docker_compose
( unset -f docker; PATH="$fixture"; expect_failure ensure_docker_installed )
( daemon_up=false; expect_failure ensure_docker_installed )
( compose_up=false; expect_failure check_docker_compose )
( mock_engine=Ubuntu; expect_failure ensure_docker_installed )
( mock_socket=remote; expect_failure ensure_docker_installed )
# Desktop owns the runtime even when the distro lacks NVIDIA tools.
( PATH="$fixture"; setup_nvidia_container_toolkit )

IS_WSL=false
mock_engine='Ubuntu'
ensure_docker_installed
( daemon_up=false; sudo() { [[ $* == 'systemctl start docker' ]]; daemon_up=true; }; ensure_docker_installed )
( compose_up=false; apt-cache() { [[ $* == 'show docker-compose-plugin' ]]; }
  sudo() { [[ $* == 'apt-get install -y docker-compose-plugin' ]]; compose_up=true; }; check_docker_compose )
( PATH="$fixture"; setup_nvidia_container_toolkit ) # CPU-only host
( nvidia-smi() { return 0; }; setup_nvidia_container_toolkit ) # Ready GB10
( runtime=''; nvidia-smi() { return 0; }; nvidia-ctk() { :; }; sleep() { :; }
  sudo() {
    case "$*" in
      'nvidia-ctk runtime configure --runtime=docker') echo configure >> "$fixture/calls" ;;
      'systemctl restart docker') echo restart >> "$fixture/calls"; runtime=yes ;;
      *) exit 93 ;;
    esac
  }
  setup_nvidia_container_toolkit
  [[ $(cat "$fixture/calls") == $'configure\nrestart' ]]
)

# Render both configurations through the actual credential and mount substitution.
curl() { cp install/management_compose.yaml "${!#}"; }
local_ip_address=127.0.0.1
for IS_WSL in true false; do
  NOMAD_DIR="$fixture/$IS_WSL"
  mkdir "$NOMAD_DIR"
  download_management_compose_file
  config=$("$real_docker" compose -f "$NOMAD_DIR/compose.yml" config --format json)
  jq -e '.services.admin.environment as $e | ($e.APP_KEY | length) == 32 and $e.DB_PASSWORD == .services.mysql.environment.MYSQL_PASSWORD' <<< "$config" >/dev/null
  mode=$(jq -r '.services["disk-collector"].volumes[] | select(.target=="/host") | .bind.propagation // "rprivate"' <<< "$config")
  if $IS_WSL; then [[ $mode == rprivate ]]; else [[ $mode == rslave ]]; fi
  expect_failure get_install_confirmation </dev/null
done
