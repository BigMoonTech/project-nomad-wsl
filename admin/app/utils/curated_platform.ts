// These pinned catalog images publish only an amd64 manifest. Check the image
// reference so a compatible replacement (including a user edit) remains usable.
const amd64OnlyImages = new Set([
  'excalidraw/excalidraw:sha-4bfc5bb',
  'ghcr.io/crosstalk-solutions/project-nomad-translate:0.1.1',
])

export function requiresAmd64(service: { container_image: string; is_custom: boolean }, arch = process.arch): boolean {
  return arch === 'arm64' && !service.is_custom && amd64OnlyImages.has(service.container_image)
}
