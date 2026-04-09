# Installing Project N.O.M.A.D. on Windows (WSL2 + Docker Desktop)

This guide walks through installing Project N.O.M.A.D. on Windows 10/11 using WSL2 (Windows Subsystem for Linux) and Docker Desktop. The same Linux install script is used — WSL2 provides a full Ubuntu environment and Docker Desktop provides the container engine.

## Prerequisites

### System Requirements

- **OS:** Windows 10 (build 19041+) or Windows 11
- **RAM:** 16GB minimum, 32GB recommended for AI workloads
- **Storage:** 250GB+ SSD recommended
- **GPU (for AI acceleration):** NVIDIA GPU with driver version **525.60.13 or later**

### 1. Enable WSL2 and Install Ubuntu

Open PowerShell as Administrator and run:

```powershell
wsl --install -d Ubuntu
```

This installs WSL2 and Ubuntu in one step. Restart your computer when prompted. After reboot, Ubuntu will launch and ask you to create a username and password.

If WSL is already installed but you need Ubuntu:

```powershell
wsl --install -d Ubuntu
```

Verify WSL2 is the default version:

```powershell
wsl --set-default-version 2
```

### 2. Install Docker Desktop

1. Download Docker Desktop from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
2. Run the installer
3. During setup, ensure **"Use WSL 2 based engine"** is checked
4. After installation, open Docker Desktop and go to:
   - **Settings > General** — confirm "Use the WSL 2 based engine" is enabled
   - **Settings > Resources > WSL Integration** — enable integration for your **Ubuntu** distro
5. Click **Apply & restart**

Verify Docker works from your Ubuntu terminal:

```bash
docker info
docker compose version
```

Both commands should succeed. If `docker` is not found, ensure WSL Integration is enabled for your Ubuntu distro in Docker Desktop settings.

### 3. Install NVIDIA GPU Driver (Required for AI Acceleration)

> **Important:** Install the NVIDIA driver on **Windows**, not inside WSL2. Docker Desktop handles GPU passthrough to containers automatically.

1. Download the latest NVIDIA driver for your GPU from [nvidia.com/download](https://www.nvidia.com/download/index.aspx)
   - Driver version must be **525.60.13 or later** (any recent Game Ready or Studio driver will work)
2. Install the driver and restart Windows if prompted

Verify GPU access from your Ubuntu terminal:

```bash
# Should display your GPU model and driver version
nvidia-smi
```

Verify Docker can access the GPU:

```bash
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi
```

This should display your GPU info from inside a container. If it does, GPU passthrough is working.

> **Do NOT** install `nvidia-container-toolkit` inside WSL2. Do NOT install NVIDIA Linux drivers inside WSL2. Docker Desktop manages all of this through the Windows driver.

## Installation

Open your Ubuntu WSL2 terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Crosstalk-Solutions/project-nomad/refs/heads/main/install/install_nomad.sh | sudo bash
```

The script will:
- Detect that it's running in WSL2
- Verify Docker Desktop is accessible
- Check for NVIDIA GPU via the Windows driver passthrough
- Create `/opt/project-nomad/` inside WSL2
- Download and configure the Docker Compose stack
- Start all services

## Post-Installation

### Access the Command Center

Open a browser on Windows and navigate to:

```
http://localhost:8080
```

### Verify GPU Acceleration

1. Open the Command Center at http://localhost:8080
2. Go through **Easy Setup** or navigate to **Settings > Apps**
3. Install **Ollama** (the AI engine)
4. Once installed, pull a model (e.g., llama3.2)
5. Start a chat — check that tokens/sec reflects GPU acceleration

You can also verify from the Ubuntu terminal:

```bash
# Check that the Ollama container has GPU access
docker exec nomad_ollama nvidia-smi
```

### Helper Scripts

After installation, these scripts are available at `/opt/project-nomad/`:

```bash
# Start all N.O.M.A.D. containers
/opt/project-nomad/start_nomad.sh

# Stop all containers
/opt/project-nomad/stop_nomad.sh

# Update to the latest version
/opt/project-nomad/update_nomad.sh
```

### Container Lifecycle

Containers are managed by Docker Desktop. They will:
- **Run** whenever Docker Desktop is running
- **Stop** when Docker Desktop is shut down or Windows is shut down
- **Restart automatically** when Docker Desktop starts (containers use `restart: unless-stopped`)

To have Docker Desktop start with Windows: **Docker Desktop > Settings > General > Start Docker Desktop when you sign in**

## Troubleshooting

### "docker: command not found" in WSL2

Docker Desktop WSL Integration is not enabled for your distro.

1. Open Docker Desktop on Windows
2. Go to **Settings > Resources > WSL Integration**
3. Toggle on your **Ubuntu** distro
4. Click **Apply & restart**
5. Close and reopen your Ubuntu terminal

### nvidia-smi not found in WSL2

The NVIDIA Windows driver is either not installed or too old.

1. Check your driver version on Windows: right-click desktop > NVIDIA Control Panel > Help > System Information
2. Update to the latest driver from [nvidia.com/download](https://www.nvidia.com/download/index.aspx)
3. Restart Windows after updating
4. Reopen Ubuntu terminal and try `nvidia-smi` again

### GPU detected but Docker NVIDIA runtime not available

```bash
# Check if Docker sees the NVIDIA runtime
docker info 2>/dev/null | grep -i runtime
```

If `nvidia` is not listed:

1. Ensure Docker Desktop is up to date
2. Restart Docker Desktop from the Windows system tray (right-click icon > Restart)
3. If still missing, try: Docker Desktop > Settings > Docker Engine, verify no conflicting runtime config

### Slow AI inference (CPU-only performance)

If Ollama is running but tokens/sec is very low, GPU may not be passed through:

```bash
# Verify GPU inside Ollama container
docker exec nomad_ollama nvidia-smi

# Check Ollama logs for GPU detection
docker logs nomad_ollama 2>&1 | head -20
```

If `nvidia-smi` fails inside the container, check the prerequisites above.

### Port 8080 already in use

Another service is using port 8080. Either stop that service or edit the compose file:

```bash
nano /opt/project-nomad/compose.yml
# Change the port mapping from "8080:8080" to "9090:8080" (or any free port)
sudo docker compose -p project-nomad -f /opt/project-nomad/compose.yml up -d
```
