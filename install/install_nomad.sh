#!/bin/bash

# Project NOMAD Installation Script

###################################################################################################################################################################################################

# Script                | Project N.O.M.A.D. Installation Script (WSL2 fork)
# Version               | 1.0.0
# Fork                  | BigMoonTech — adds Windows/WSL2 + Docker Desktop support
# Original Author       | Crosstalk Solutions, LLC (https://crosstalksolutions.com)
# Fork Repo             | https://github.com/BigMoonTech/project-nomad-wsl

###################################################################################################################################################################################################
#                                                                                                                                                                                                 #
#                                                                                           Color Codes                                                                                           #
#                                                                                                                                                                                                 #
###################################################################################################################################################################################################

RESET='\033[0m'
YELLOW='\033[1;33m'
WHITE_R='\033[39m' # Same as GRAY_R for terminals with white background.
GRAY_R='\033[39m'
RED='\033[1;31m' # Light Red.
GREEN='\033[1;32m' # Light Green.

###################################################################################################################################################################################################
#                                                                                                                                                                                                 #
#                                                                                  Constants & Variables                                                                                          #
#                                                                                                                                                                                                 #
###################################################################################################################################################################################################

WHIPTAIL_TITLE="Project NOMAD Installation"
NOMAD_DIR="/opt/project-nomad"
IS_WSL=false
if grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=true
fi
MANAGEMENT_COMPOSE_FILE_URL="https://raw.githubusercontent.com/BigMoonTech/project-nomad-wsl/refs/heads/main/install/management_compose.yaml"
START_SCRIPT_URL="https://raw.githubusercontent.com/BigMoonTech/project-nomad-wsl/refs/heads/main/install/start_nomad.sh"
STOP_SCRIPT_URL="https://raw.githubusercontent.com/BigMoonTech/project-nomad-wsl/refs/heads/main/install/stop_nomad.sh"
UPDATE_SCRIPT_URL="https://raw.githubusercontent.com/BigMoonTech/project-nomad-wsl/refs/heads/main/install/update_nomad.sh"
script_option_debug='true'
accepted_terms='false'
local_ip_address=''

###################################################################################################################################################################################################
#                                                                                                                                                                                                 #
#                                                                                           Functions                                                                                             #
#                                                                                                                                                                                                 #
###################################################################################################################################################################################################

header() {
  if [[ "${script_option_debug}" != 'true' ]]; then clear; clear; fi
  echo -e "${GREEN}#########################################################################${RESET}\\n"
}

header_red() {
  if [[ "${script_option_debug}" != 'true' ]]; then clear; clear; fi
  echo -e "${RED}#########################################################################${RESET}\\n"
}

banner() {
  echo ""
  echo -e "${GREEN}"
  cat <<'NOMAD_ART'
                             P R O J E C T
                    _   _  ___  __  __    _    ____
                   | \ | |/ _ \|  \/  |  / \  |  _ \
                   |  \| | | | | |\/| | / _ \ | | | |
                   | |\  | |_| | |  | |/ ___ \| |_| |
                   |_| \_|\___/|_|  |_/_/   \_\____/
NOMAD_ART
  echo -e "${RESET}"
  echo -e "${WHITE_R}                 Offline knowledge and education server${RESET}\n"
  echo -e "${GREEN}#########################################################################${RESET}\n"
}

check_has_sudo() {
  if sudo -n true 2>/dev/null; then
    echo -e "${GREEN}#${RESET} User has sudo permissions.\\n"
  else
    echo "User does not have sudo permissions"
    header_red
    echo -e "${RED}#${RESET} This script requires sudo permissions to run. Please run the script with sudo.\\n"
    echo -e "${RED}#${RESET} For example: sudo bash $(basename "$0")"
    exit 1
  fi
}

check_is_bash() {
  if [[ -z "$BASH_VERSION" ]]; then
    header_red
    echo -e "${RED}#${RESET} This script requires bash to run. Please run the script using bash.\\n"
    echo -e "${RED}#${RESET} For example: bash $(basename "$0")"
    exit 1
  fi
    echo -e "${GREEN}#${RESET} This script is running in bash.\\n"
}

check_is_debian_based() {
  if [[ ! -f /etc/debian_version ]]; then
    header_red
    echo -e "${RED}#${RESET} This script is designed to run on Debian-based systems only.\\n"
    echo -e "${RED}#${RESET} Please run this script on a Debian-based system and try again."
    exit 1
  fi
    echo -e "${GREEN}#${RESET} This script is running on a Debian-based system.\\n"
}

check_architecture() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64|aarch64|arm64) echo -e "${GREEN}#${RESET} Architecture check passed (${arch})." ;;
    *) echo -e "${RED}#${RESET} Unsupported architecture '${arch}'. NOMAD requires x86-64 or ARM64 Linux." >&2; exit 1 ;;
  esac
}

ensure_dependencies_installed() {
  local missing_deps=()

  # Check for curl
  if ! command -v curl &> /dev/null; then
    missing_deps+=("curl")
  fi

  # Check for gpg (required for NVIDIA container toolkit keyring)
  if ! command -v gpg &> /dev/null; then
    missing_deps+=("gpg")
  fi

  # Check for whiptail (used for dialogs, though not currently active)
  # if ! command -v whiptail &> /dev/null; then
  #   missing_deps+=("whiptail")
  # fi

  if [[ ${#missing_deps[@]} -gt 0 ]]; then
    echo -e "${YELLOW}#${RESET} Installing required dependencies: ${missing_deps[*]}...\\n"
    sudo apt-get update
    sudo apt-get install -y "${missing_deps[@]}"

    # Verify installation
    for dep in "${missing_deps[@]}"; do
      if ! command -v "$dep" &> /dev/null; then
        echo -e "${RED}#${RESET} Failed to install $dep. Please install it manually and try again."
        exit 1
      fi
    done
    echo -e "${GREEN}#${RESET} Dependencies installed successfully.\\n"
  else
    echo -e "${GREEN}#${RESET} All required dependencies are already installed.\\n"
  fi
}

check_is_debug_mode(){
  # Check if the script is being run in debug mode
  if [[ "${script_option_debug}" == 'true' ]]; then
    echo -e "${YELLOW}#${RESET} Debug mode is enabled, the script will not clear the screen...\\n"
  else
    clear; clear
  fi
}

generateRandomPass() {
  local length="${1:-32}"  # Default to 32
  local password
  
  # Generate random password using /dev/urandom
  password=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$length")
  
  echo "$password"
}

ensure_docker_installed() {
  if ! command -v docker >/dev/null; then
    if $IS_WSL; then
      echo "Install Docker Desktop on Windows and enable WSL integration for this distribution." >&2
      return 1
    fi
    local script
    script=$(mktemp) || return 1
    if ! curl -fsSL --retry 3 https://get.docker.com -o "$script" || ! sudo sh "$script"; then
      rm -f "$script"
      echo "Docker Engine installation failed." >&2
      return 1
    fi
    rm -f "$script"
  fi

  # All production bind mounts resolve on the local engine. Check the actual
  # socket used by Command Center before installing anything into /opt.
  local engine
  if ! engine=$(docker info --format '{{.OperatingSystem}}' 2>/dev/null); then
    if $IS_WSL; then
      echo "Start Docker Desktop on Windows and enable WSL integration for this distribution." >&2
      return 1
    fi
    if ! sudo systemctl start docker || ! engine=$(docker info --format '{{.OperatingSystem}}'); then
      echo "The Docker CLI is installed but cannot reach the local Docker Engine." >&2
      return 1
    fi
  fi
  if [[ $(docker info --format '{{.OSType}}') != linux ]]; then
    echo "NOMAD requires Linux containers. Switch Docker Desktop to its Linux engine." >&2
    return 1
  fi
  local socket_id
  socket_id=$(docker --host unix:///var/run/docker.sock info --format '{{.ID}}') || return 1
  if [[ -z "$socket_id" || "$socket_id" != "$(docker info --format '{{.ID}}')" ]]; then
    echo "Select the local engine that provides /var/run/docker.sock. NOMAD uses this socket and local bind mounts." >&2
    return 1
  fi
  if ! $IS_WSL && [[ "$engine" == *"Docker Desktop"* ]]; then
    echo "Select the native Docker Engine on Linux (docker context use default), then rerun the installer." >&2
    return 1
  fi
  if $IS_WSL && [[ "$engine" != *"Docker Desktop"* ]]; then
    echo "Enable Docker Desktop's WSL integration and select its engine in this distribution." >&2
    return 1
  fi
  local daemon_arch
  daemon_arch=$(docker info --format '{{.Architecture}}')
  case "$daemon_arch" in
    x86_64|amd64) export DOCKER_DEFAULT_PLATFORM=linux/amd64 ;;
    aarch64|arm64) export DOCKER_DEFAULT_PLATFORM=linux/arm64 ;;
    *) echo "Unsupported Docker Engine architecture: $daemon_arch" >&2; return 1 ;;
  esac
  echo "Connected to $engine. Installing $DOCKER_DEFAULT_PLATFORM images."
}

check_docker_compose() {
  if docker compose version >/dev/null 2>&1; then return 0; fi
  if $IS_WSL; then
    echo "Enable or update Docker Desktop's Compose plugin for this WSL distribution." >&2
    return 1
  fi
  sudo apt-get update || return 1
  local package
  for package in docker-compose-plugin docker-compose-v2; do
    if apt-cache show "$package" >/dev/null 2>&1 && sudo apt-get install -y "$package" && docker compose version >/dev/null; then
      return 0
    fi
  done
  echo "Install the Docker Compose plugin for your Docker Engine, then rerun the installer." >&2
  return 1
}

docker_has_nvidia_runtime() {
  [[ $(docker info --format '{{if index .Runtimes "nvidia"}}yes{{end}}' 2>/dev/null) == yes ]]
}

setup_nvidia_container_toolkit() {
  # This function attempts to set up NVIDIA GPU support but is non-blocking
  # Any failures will result in warnings but will NOT stop the installation process

  echo -e "${YELLOW}#${RESET} Checking for NVIDIA GPU...\\n"

  if $IS_WSL; then
    # On WSL2 + Docker Desktop, GPU passthrough is handled entirely by Docker Desktop
    # and the NVIDIA Windows driver. We do NOT install nvidia-container-toolkit or
    # modify daemon.json — those apply to native Linux Docker only.
    setup_nvidia_wsl2
    return $?
  fi

  # --- Native Linux GPU setup below ---

  # Safely detect NVIDIA GPU
  local has_nvidia_gpu=false
  if command -v lspci &> /dev/null; then
    if lspci 2>/dev/null | grep -Ei 'VGA|3D controller|Display controller' | grep -qi nvidia; then
      has_nvidia_gpu=true
      echo -e "${GREEN}#${RESET} NVIDIA GPU detected.\\n"
    fi
  fi

  # Also check for nvidia-smi
  if ! $has_nvidia_gpu && command -v nvidia-smi &> /dev/null; then
    if nvidia-smi &> /dev/null; then
      has_nvidia_gpu=true
      echo -e "${GREEN}#${RESET} NVIDIA GPU detected via nvidia-smi.\\n"
    fi
  fi

  if ! $has_nvidia_gpu; then
    echo -e "${YELLOW}#${RESET} No NVIDIA GPU detected. Skipping NVIDIA container toolkit installation.\\n"
    return 0
  fi

  # A preconfigured DGX Spark already exposes the NVIDIA runtime.
  if docker_has_nvidia_runtime; then
    echo "Docker already provides the NVIDIA runtime."
    return 0
  fi

  # Install only when the toolkit itself is missing.
  if ! command -v nvidia-ctk >/dev/null; then
    echo -e "${YELLOW}#${RESET} Installing NVIDIA container toolkit...\\n"

    # Install dependencies per https://docs.ollama.com/docker - wrapped in error handling
    if ! curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey 2>/dev/null | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null; then
      echo -e "${YELLOW}#${RESET} Warning: Failed to add NVIDIA container toolkit GPG key. Continuing anyway...\\n"
      return 0
    fi

    if ! curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list 2>/dev/null \
        | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
        | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null 2>&1; then
      echo -e "${YELLOW}#${RESET} Warning: Failed to add NVIDIA container toolkit repository. Continuing anyway...\\n"
      return 0
    fi

    if ! sudo apt-get update 2>/dev/null; then
      echo -e "${YELLOW}#${RESET} Warning: Failed to update package list. Continuing anyway...\\n"
      return 0
    fi

    if ! sudo apt-get install -y nvidia-container-toolkit 2>/dev/null; then
      echo -e "${YELLOW}#${RESET} Warning: Failed to install NVIDIA container toolkit. Continuing anyway...\\n"
      return 0
    fi

    echo -e "${GREEN}#${RESET} NVIDIA container toolkit installed successfully.\\n"
  fi

  # Configure Docker to use NVIDIA runtime
  echo -e "${YELLOW}#${RESET} Configuring Docker to use NVIDIA runtime...\\n"

  if ! sudo nvidia-ctk runtime configure --runtime=docker; then
    echo "NVIDIA runtime configuration failed. Continuing with CPU support." >&2
    return 0
  fi

  # Restart Docker service
  echo -e "${YELLOW}#${RESET} Restarting Docker service...\\n"
  if ! sudo systemctl restart docker 2>/dev/null; then
    echo -e "${YELLOW}#${RESET} Warning: Failed to restart Docker service. You may need to restart it manually.\\n"
    return 0
  fi

  # Verify NVIDIA runtime is available
  echo -e "${YELLOW}#${RESET} Verifying NVIDIA runtime configuration...\\n"
  sleep 2  # Give Docker a moment to fully restart

  if docker_has_nvidia_runtime; then
    echo -e "${GREEN}#${RESET} NVIDIA runtime successfully configured and verified.\\n"
  else
    echo -e "${YELLOW}#${RESET} Warning: NVIDIA runtime not detected in Docker info. GPU acceleration may not work.\\n"
    echo -e "${YELLOW}#${RESET} You may need to manually configure /etc/docker/daemon.json and restart Docker.\\n"
  fi

  echo -e "${GREEN}#${RESET} NVIDIA container toolkit configuration completed.\\n"
}

setup_nvidia_wsl2() {
  # WSL2 + Docker Desktop GPU setup.
  # Docker Desktop handles the NVIDIA runtime — no toolkit installation or daemon.json needed.
  # The only requirement is the correct NVIDIA Windows driver (525.60.13+).

  # Find nvidia-smi — sudo can strip PATH, so check common WSL2 locations explicitly
  local nvidia_smi=""
  if command -v nvidia-smi &> /dev/null; then
    nvidia_smi="nvidia-smi"
  elif [[ -x /usr/lib/wsl/lib/nvidia-smi ]]; then
    nvidia_smi="/usr/lib/wsl/lib/nvidia-smi"
  fi

  # Check if nvidia-smi is available (provided by the NVIDIA Windows driver into WSL2)
  if [[ -n "$nvidia_smi" ]] && $nvidia_smi &> /dev/null; then
    echo -e "${GREEN}#${RESET} NVIDIA GPU detected via WSL2 driver passthrough:\\n"
    $nvidia_smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null | while read -r line; do
      echo -e "  ${WHITE_R}$line${RESET}"
    done
    echo ""
  else
    echo -e "${YELLOW}#${RESET} nvidia-smi not available in WSL2.\\n"
    echo -e "${YELLOW}#${RESET} To enable GPU acceleration, install the NVIDIA Windows driver (525.60.13 or later)\\n"
    echo -e "${YELLOW}#${RESET} from https://www.nvidia.com/download/index.aspx\\n"
    echo -e "${YELLOW}#${RESET} Continuing without GPU support...\\n"
    return 0
  fi

  # Verify Docker Desktop exposes the NVIDIA runtime
  if docker_has_nvidia_runtime; then
    echo -e "${GREEN}#${RESET} Docker Desktop advertises the NVIDIA runtime.\\n"
  else
    echo -e "${YELLOW}#${RESET} NVIDIA GPU is present but Docker Desktop does not show the NVIDIA runtime.\\n"
    echo -e "${YELLOW}#${RESET} Please check the following:\\n"
    echo -e "${YELLOW}#${RESET}   1. Docker Desktop is up to date\\n"
    echo -e "${YELLOW}#${RESET}   2. Settings > General > 'Use the WSL 2 based engine' is enabled\\n"
    echo -e "${YELLOW}#${RESET}   3. NVIDIA Windows driver is version 525.60.13 or later\\n"
    echo -e "${YELLOW}#${RESET}   4. Try restarting Docker Desktop from the Windows system tray\\n"
    echo -e "${YELLOW}#${RESET} Continuing without GPU support...\\n"
  fi

  return 0
}

get_install_confirmation(){
  echo -e "${YELLOW}#${RESET} This script will install Project NOMAD and its dependencies on your machine."
  if [[ -e "${NOMAD_DIR}/compose.yml" || -d "${NOMAD_DIR}/mysql" ]]; then
    echo -e "${RED}#${RESET} Found an existing installation at ${NOMAD_DIR}. Use Settings → Check for Updates or the existing update script." >&2
    exit 1
  fi
  read -p "Are you sure you want to continue? (y/N): " choice
  case "$choice" in
    y|Y )
      echo -e "${GREEN}#${RESET} User chose to continue with the installation."
      ;;
    * )
      echo "User chose not to continue with the installation."
      exit 0
      ;;
  esac
}

accept_terms() {
  printf "\n\n"
  echo "License Agreement & Terms of Use"
  echo "__________________________"
  printf "\n\n"
  echo "Project NOMAD is licensed under the Apache License 2.0. The full license can be found at https://www.apache.org/licenses/LICENSE-2.0 or in the LICENSE file of this repository."
  printf "\n"
  echo "By accepting this agreement, you acknowledge that you have read and understood the terms and conditions of the Apache License 2.0 and agree to be bound by them while using Project NOMAD"
  echo -e "\n\n"
  read -p "I have read and accept License Agreement & Terms of Use (y/N)? " choice
  case "$choice" in
    y|Y )
      accepted_terms='true'
      ;;
    * )
      echo "License Agreement & Terms of Use not accepted. Installation cannot continue."
      exit 1
      ;;
  esac
}

create_nomad_directory(){
  # Ensure the main installation directory exists
  if [[ ! -d "$NOMAD_DIR" ]]; then
    echo -e "${YELLOW}#${RESET} Creating directory for Project NOMAD at $NOMAD_DIR...\\n"
    sudo mkdir -p "$NOMAD_DIR"
    sudo chown "$(whoami):$(whoami)" "$NOMAD_DIR"

    echo -e "${GREEN}#${RESET} Directory created successfully.\\n"
  else
    echo -e "${GREEN}#${RESET} Directory $NOMAD_DIR already exists.\\n"
  fi

  # Also ensure the directory has a /storage/logs/ subdirectory
  sudo mkdir -p "${NOMAD_DIR}/storage/logs"

  # Create a admin.log file in the logs directory
  sudo touch "${NOMAD_DIR}/storage/logs/admin.log"
}

download_management_compose_file() {
  local compose_file_path
  compose_file_path=$(mktemp "${NOMAD_DIR}/.compose.XXXXXX") || return 1

  echo -e "${YELLOW}#${RESET} Downloading docker-compose file for management...\\n"
  if ! curl -fsSL "$MANAGEMENT_COMPOSE_FILE_URL" -o "$compose_file_path"; then
    echo -e "${RED}#${RESET} Failed to download the docker compose file. Please check the URL and try again."
    exit 1
  fi
  echo -e "${GREEN}#${RESET} Docker compose file downloaded successfully to $compose_file_path.\\n"

  local app_key=$(generateRandomPass)
  local db_root_password=$(generateRandomPass)
  local db_user_password=$(generateRandomPass)

  # Inject dynamic env values into the compose file
  echo -e "${YELLOW}#${RESET} Configuring docker-compose file env variables...\\n"
  sed -i "s|URL=replaceme|URL=http://${local_ip_address}:8080|g" "$compose_file_path"
  sed -i "s|APP_KEY=replaceme|APP_KEY=${app_key}|g" "$compose_file_path"
  
  sed -i "s|DB_PASSWORD=replaceme|DB_PASSWORD=${db_user_password}|g" "$compose_file_path"
  sed -i "s|MYSQL_ROOT_PASSWORD=replaceme|MYSQL_ROOT_PASSWORD=${db_root_password}|g" "$compose_file_path"
  sed -i "s|MYSQL_PASSWORD=replaceme|MYSQL_PASSWORD=${db_user_password}|g" "$compose_file_path"

  # WSL2: The disk-collector sidecar's "rslave" mount propagation flag fails because
  # WSL2's root filesystem is not a shared mount. Replace with plain read-only mount.
  # Only trade-off: hot-plugged drives won't auto-appear (irrelevant for WSL2 desktops).
  if $IS_WSL; then
    echo -e "${YELLOW}#${RESET} WSL2 detected: adjusting disk-collector mount for compatibility...\\n"
    sed -i 's|/:/host:ro,rslave|/:/host:ro|' "$compose_file_path"
  fi

  docker compose -f "$compose_file_path" config --quiet || { rm -f "$compose_file_path"; return 1; }
  mv "$compose_file_path" "${NOMAD_DIR}/compose.yml" || return 1
  echo -e "${GREEN}#${RESET} Docker compose file configured successfully.\\n"
}

download_helper_scripts() {
  local start_script_path="${NOMAD_DIR}/start_nomad.sh"
  local stop_script_path="${NOMAD_DIR}/stop_nomad.sh"
  local update_script_path="${NOMAD_DIR}/update_nomad.sh"

  echo -e "${YELLOW}#${RESET} Downloading helper scripts...\\n"
  if ! curl -fsSL --retry 5 --retry-delay 3 "$START_SCRIPT_URL" -o "$start_script_path"; then
    echo -e "${RED}#${RESET} Failed to download the start script. Please check the URL and try again."
    exit 1
  fi
  chmod +x "$start_script_path"

  if ! curl -fsSL --retry 5 --retry-delay 3 "$STOP_SCRIPT_URL" -o "$stop_script_path"; then
    echo -e "${RED}#${RESET} Failed to download the stop script. Please check the URL and try again."
    exit 1
  fi
  chmod +x "$stop_script_path"

  if ! curl -fsSL --retry 5 --retry-delay 3 "$UPDATE_SCRIPT_URL" -o "$update_script_path"; then
    echo -e "${RED}#${RESET} Failed to download the update script. Please check the URL and try again."
    exit 1
  fi
  chmod +x "$update_script_path"

  echo -e "${GREEN}#${RESET} Helper scripts downloaded successfully to $start_script_path, $stop_script_path, and $update_script_path.\\n"
}

start_management_containers() {
  echo -e "${YELLOW}#${RESET} Starting management containers using docker compose...\\n"
  if ! sudo docker compose -p project-nomad -f "${NOMAD_DIR}/compose.yml" up -d --wait --wait-timeout 240; then
    echo -e "${RED}#${RESET} Failed to start management containers. Please check the logs and try again."
    exit 1
  fi
  echo -e "${GREEN}#${RESET} Management containers started successfully.\\n"
}

get_local_ip() {
  local_ip_address=$(hostname -I | awk '{print $1}')
  if [[ -z "$local_ip_address" ]]; then
    echo -e "${RED}#${RESET} Unable to determine local IP address. Please check your network configuration."
    exit 1
  fi
}
verify_gpu_setup() {
  # This function only displays GPU setup status and is completely non-blocking
  # It never exits or returns error codes - purely informational

  echo -e "\\n${YELLOW}#${RESET} GPU Setup Verification\\n"
  echo -e "${YELLOW}===========================================${RESET}\\n"

  # Find nvidia-smi (sudo strips PATH; on WSL2 it lives in /usr/lib/wsl/lib/)
  local nvidia_smi=""
  if command -v nvidia-smi &> /dev/null; then
    nvidia_smi="nvidia-smi"
  elif [[ -x /usr/lib/wsl/lib/nvidia-smi ]]; then
    nvidia_smi="/usr/lib/wsl/lib/nvidia-smi"
  fi

  # Check if NVIDIA GPU is present
  if [[ -n "$nvidia_smi" ]] && $nvidia_smi &> /dev/null; then
    echo -e "${GREEN}✓${RESET} NVIDIA GPU detected:"
    $nvidia_smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | while read -r line; do
      echo -e "  ${WHITE_R}$line${RESET}"
    done
    echo ""
  else
    echo -e "${YELLOW}○${RESET} No NVIDIA GPU detected (nvidia-smi not available)\\n"
  fi

  # Check if NVIDIA Container Toolkit is installed (not applicable on WSL2)
  if $IS_WSL; then
    echo -e "${GREEN}✓${RESET} WSL2 — GPU runtime managed by Docker Desktop (no toolkit needed)\\n"
  elif command -v nvidia-ctk &> /dev/null; then
    echo -e "${GREEN}✓${RESET} NVIDIA Container Toolkit installed: $(nvidia-ctk --version 2>/dev/null | head -n1)\\n"
  else
    echo -e "${YELLOW}○${RESET} NVIDIA Container Toolkit not installed\\n"
  fi

  # Check if Docker has NVIDIA runtime
  if docker_has_nvidia_runtime; then
    echo -e "${GREEN}✓${RESET} Docker NVIDIA runtime configured\\n"
  else
    echo -e "${YELLOW}○${RESET} Docker NVIDIA runtime not detected\\n"
  fi

  # Check for AMD GPU — restrict to display controller classes to avoid false positives
  # from AMD CPU host bridges, PCI bridges, and chipset devices.
  local has_amd_gpu='false'
  local amd_gfx_version=''
  if command -v lspci &> /dev/null; then
    if lspci 2>/dev/null | grep -iE "VGA|3D controller|Display" | grep -iE "amd|radeon" &> /dev/null; then
      has_amd_gpu='true'
      echo -e "${GREEN}✓${RESET} AMD GPU detected — ROCm acceleration will be configured automatically when AI Assistant is installed.\\n"

      # Map AMD codename → gfx version so the admin can pick the right HSA_OVERRIDE_GFX_VERSION.
      # gfx1030/1100/1101/1102 are on AMD's official ROCm allowlist and need NO override —
      # forcing one (e.g. 11.0.0) breaks GPU discovery on these. Other variants do need it.
      local amd_devices
      amd_devices=$(lspci -vmm 2>/dev/null | awk -F'\t' '/^Class:.*(VGA|3D|Display)/{c=1} c && /^Device:/{print $2; c=0}')
      if echo "${amd_devices}" | grep -iq 'Navi 21'; then
        amd_gfx_version='gfx1030'
      elif echo "${amd_devices}" | grep -iq 'Navi 22'; then
        amd_gfx_version='gfx1031'
      elif echo "${amd_devices}" | grep -iq 'Navi 23'; then
        amd_gfx_version='gfx1032'
      elif echo "${amd_devices}" | grep -iq 'Navi 24'; then
        amd_gfx_version='gfx1034'
      elif echo "${amd_devices}" | grep -iq 'Rembrandt'; then
        amd_gfx_version='gfx1035'
      elif echo "${amd_devices}" | grep -iEq 'Phoenix[0-9]?|Hawk ?Point ?[0-9]?|Radeon (780M|760M)'; then
        # Phoenix (Ryzen 7040) / Hawk Point (Ryzen 8040) — 780M & 760M are both gfx1103.
        # lspci device strings vary (Phoenix1/Phoenix2/Phoenix3, "Hawk Point", "HawkPoint1", or the bare
        # "Radeon 780M Graphics" marketing name), so match all of them or the marker goes
        # missing and the 780M silently drops to CPU. Kept before the Strix branches so a
        # "Radeon 780M" string can't be miscaught. See gfx1103 regression.
        amd_gfx_version='gfx1103'
      elif echo "${amd_devices}" | grep -iEq 'Strix Halo'; then
        amd_gfx_version='gfx1151'
      elif echo "${amd_devices}" | grep -iEq 'Strix( Point)?'; then
        amd_gfx_version='gfx1150'
      elif echo "${amd_devices}" | grep -iq 'Navi 31'; then
        amd_gfx_version='gfx1100'
      elif echo "${amd_devices}" | grep -iq 'Navi 32'; then
        amd_gfx_version='gfx1101'
      elif echo "${amd_devices}" | grep -iq 'Navi 33'; then
        amd_gfx_version='gfx1102'
      fi
    fi
  fi

  # Write detected GPU type to a marker file the admin container can read. The admin
  # container lacks lspci and AMD GPUs don't register a Docker runtime, so this is the
  # only reliable way for the admin to know an AMD GPU is present at install time.
  # WSL2: use $nvidia_smi (resolves the /usr/lib/wsl/lib path) since sudo strips PATH.
  local gpu_marker_path="${NOMAD_DIR}/storage/.nomad-gpu-type"
  if [[ -n "$nvidia_smi" ]] && $nvidia_smi &> /dev/null; then
    echo 'nvidia' | sudo tee "${gpu_marker_path}" > /dev/null 2>&1 || true
  elif [[ "${has_amd_gpu}" == 'true' ]]; then
    echo 'amd' | sudo tee "${gpu_marker_path}" > /dev/null 2>&1 || true
  else
    sudo rm -f "${gpu_marker_path}" 2>/dev/null || true
  fi

  # Companion marker used by the admin to pick the right HSA_OVERRIDE_GFX_VERSION for
  # the detected card. Absence of this file means "unknown gfx" — the admin falls back
  # to its built-in default. Always rewrite (or remove) on install to keep state fresh.
  local amd_gfx_marker_path="${NOMAD_DIR}/storage/.nomad-amd-gfx"
  if [[ -n "${amd_gfx_version}" ]]; then
    echo "${amd_gfx_version}" | sudo tee "${amd_gfx_marker_path}" > /dev/null 2>&1 || true
  else
    sudo rm -f "${amd_gfx_marker_path}" 2>/dev/null || true
  fi

  echo -e "${YELLOW}===========================================${RESET}\\n"

  # Summary — on WSL2 trust docker info over nvidia-smi availability
  local gpu_detected=false
  if [[ -n "$nvidia_smi" ]] && $nvidia_smi &> /dev/null; then
    gpu_detected=true
  fi

  local admin_image
  admin_image=$(docker inspect --format '{{.Image}}' nomad_admin 2>/dev/null) || admin_image=''
  if [[ -n "$admin_image" ]] && docker_has_nvidia_runtime &&
     docker run --rm --network none --gpus all --entrypoint /bin/sh "$admin_image" \
       -c 'timeout 15 nvidia-smi -L | grep -q "^GPU "'; then
    echo -e "${GREEN}#${RESET} GPU acceleration is properly configured! The AI Assistant will use your GPU.\\n"
  elif [[ "${has_amd_gpu}" == 'true' ]]; then
    echo -e "${GREEN}#${RESET} GPU acceleration will be enabled (AMD/ROCm) when AI Assistant is installed from the dashboard.\\n"
  else
    echo -e "${YELLOW}#${RESET} GPU acceleration not detected. The AI Assistant will run in CPU-only mode.\\n"
    if $gpu_detected && ! docker_has_nvidia_runtime; then
      echo -e "${YELLOW}#${RESET} Tip: Your GPU is detected but Docker runtime is not configured.\\n"
      if $IS_WSL; then
        echo -e "${YELLOW}#${RESET} Try restarting Docker Desktop from the Windows system tray.\\n"
      else
        echo -e "${YELLOW}#${RESET} Try restarting Docker: ${WHITE_R}sudo systemctl restart docker${RESET}\\n"
      fi
    fi
  fi
}

success_message() {
  echo -e "${GREEN}#${RESET} Project N.O.M.A.D installation completed successfully!\\n"
  echo -e "${GREEN}#${RESET} Installation files are located at ${NOMAD_DIR}\\n\\n"
  if $IS_WSL; then
    echo -e "${GREEN}#${RESET} Containers will run as long as Docker Desktop is running on Windows.\\n"
    echo -e "${GREEN}#${RESET} To start containers manually: ${WHITE_R}${NOMAD_DIR}/start_nomad.sh${RESET}\\n"
  else
    echo -e "${GREEN}#${RESET} Project N.O.M.A.D's Command Center should automatically start whenever your device reboots. However, if you need to start it manually, you can always do so by running: ${WHITE_R}${NOMAD_DIR}/start_nomad.sh${RESET}\\n"
  fi
  echo -e "${GREEN}#${RESET} You can now access the management interface at http://localhost:8080 or http://${local_ip_address}:8080\\n"
  echo -e "${GREEN}#${RESET} Thank you for supporting Project NOMAD!\\n"
}

###################################################################################################################################################################################################
#                                                                                                                                                                                                 #
#                                                                                           Main Script                                                                                           #
#                                                                                                                                                                                                 #
###################################################################################################################################################################################################

main() {
  set -e
  check_is_bash
  check_is_debian_based
  check_architecture
  check_has_sudo
  check_is_debug_mode
  banner
  sudo mkdir -p /run/project-nomad-installer
  exec 9</run/project-nomad-installer
  flock -n 9 || { echo "Another NOMAD installation is in progress." >&2; return 1; }
  get_install_confirmation
  accept_terms
  ensure_dependencies_installed
  ensure_docker_installed
  check_docker_compose
  setup_nvidia_container_toolkit
  get_local_ip
  create_nomad_directory
  download_helper_scripts
  download_management_compose_file
  start_management_containers
  verify_gpu_setup
  success_message
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main; fi

# free_space_check() {
#   if [[ "$(df -B1 / | awk 'NR==2{print $4}')" -le '5368709120' ]]; then
#     header_red
#     echo -e "${YELLOW}#${RESET} You only have $(df -B1 / | awk 'NR==2{print $4}' | awk '{ split( "B KB MB GB TB PB EB ZB YB" , v ); s=1; while( $1>1024 && s<9 ){ $1/=1024; s++ } printf "%.1f %s", $1, v[s] }') of disk space available on \"/\"... \\n"
#     while true; do
#       read -rp $'\033[39m#\033[0m Do you want to proceed with running the script? (y/N) ' yes_no
#       case "$yes_no" in
#          [Nn]*|"")
#             free_space_check_response="Cancel script"
#             free_space_check_date="$(date +%s)"
#             echo -e "${YELLOW}#${RESET} OK... Please free up disk space before running the script again..."
#             cancel_script
#             break;;
#          [Yy]*)
#             free_space_check_response="Proceed at own risk"
#             free_space_check_date="$(date +%s)"
#             echo -e "${YELLOW}#${RESET} OK... Proceeding with the script.. please note that failures may occur due to not enough disk space... \\n"; sleep 10
#             break;;
#          *) echo -e "\\n${RED}#${RESET} Invalid input, please answer Yes or No (y/n)...\\n"; sleep 3;;
#       esac
#     done
#     if [[ -n "$(command -v jq)" ]]; then
#       if [[ "$(dpkg-query --showformat='${version}' --show jq 2> /dev/null | sed -e 's/.*://' -e 's/-.*//g' -e 's/[^0-9.]//g' -e 's/\.//g' | sort -V | tail -n1)" -ge "16" && -e "${eus_dir}/db/db.json" ]]; then
#         jq '.scripts."'"${script_name}"'" += {"warnings": {"low-free-disk-space": {"response": "'"${free_space_check_response}"'", "detected-date": "'"${free_space_check_date}"'"}}}' "${eus_dir}/db/db.json" > "${eus_dir}/db/db.json.tmp" 2>> "${eus_dir}/logs/eus-database-management.log"
#       else
#         jq '.scripts."'"${script_name}"'" = (.scripts."'"${script_name}"'" | . + {"warnings": {"low-free-disk-space": {"response": "'"${free_space_check_response}"'", "detected-date": "'"${free_space_check_date}"'"}}})' "${eus_dir}/db/db.json" > "${eus_dir}/db/db.json.tmp" 2>> "${eus_dir}/logs/eus-database-management.log"
#       fi
#       eus_database_move
#     fi
#   fi
# }
