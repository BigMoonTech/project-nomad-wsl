import type { Systeminformation } from 'systeminformation'
import type { NomadDiskInfo } from '../../types/system.js'

// Only the fields buildWsl2StorageDisk needs; si.fsSize() entries satisfy this.
type DiskFsEntry = Pick<Systeminformation.FsSizeData, 'fs' | 'size' | 'used' | 'use' | 'mount'>

/**
 * True when the kernel string indicates a WSL2 environment. Windows ships a
 * single shared kernel for every WSL2 distribution (and Docker Desktop's own
 * utility VM), tagged "microsoft-standard-WSL2". A native Debian/Ubuntu kernel
 * (e.g. "5.15.0-91-generic") never contains "microsoft".
 */
export function isWsl2Kernel(kernel: string | undefined | null): boolean {
  return /microsoft/i.test(kernel ?? '')
}

/**
 * On WSL2 + Docker Desktop the disk-collector runs inside Docker Desktop's
 * utility VM and can only see that VM's virtual disks, never the user's real
 * storage. The disk that actually holds NOMAD content is the one backing
 * /app/storage (the admin container's bind mount from /opt/project-nomad/storage),
 * which resolves to the WSL distro's own virtual disk. Build a single display
 * disk from that filesystem.
 *
 * Returns [] when /app/storage is absent or zero-sized, so the caller can leave
 * the existing (native) disk list untouched.
 */
export function buildWsl2StorageDisk(fsSize: DiskFsEntry[]): NomadDiskInfo[] {
  const entry = fsSize.find((f) => f.mount === '/app/storage' && f.size > 0)
  if (!entry) {
    return []
  }

  return [
    {
      name: 'NOMAD Storage',
      model: 'WSL2 virtual disk',
      vendor: '',
      rota: false,
      tran: '',
      size: String(entry.size),
      totalUsed: entry.used,
      totalSize: entry.size,
      // df capacity percent (used / (used + available)); matches `df -h` and
      // accounts for ext4 reserved blocks, unlike a raw used/size ratio.
      percentUsed: Math.round((entry.use ?? 0) * 100) / 100,
      filesystems: [
        {
          fs: entry.fs,
          mount: entry.mount,
          used: entry.used,
          size: entry.size,
          percentUsed: entry.use,
        },
      ],
    },
  ]
}
