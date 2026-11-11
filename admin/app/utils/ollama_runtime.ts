import { isNewerVersion } from './version.js'

export const NOMAD_OLLAMA_REPOSITORY = 'ghcr.io/bigmoontech/project-nomad-wsl-ollama'
export const NOMAD_OLLAMA_SOURCE = 'https://github.com/BigMoonTech/project-nomad-wsl'
export const NOMAD_OLLAMA_ENGINE = '0.40.16'
export const FIRST_NOMAD_OLLAMA_RELEASE = '1.35.105'

const versionPattern = /^v?\d+\.\d+\.\d+$/
const officialPattern = /^(?:(?:docker\.io|registry-1\.docker\.io)\/)?ollama\/ollama:(v?\d+\.\d+\.\d+)$/

export function isNomadOllamaImage(image: string): boolean {
  return image.startsWith(`${NOMAD_OLLAMA_REPOSITORY}:`)
}

export function canMigrateOllamaRuntime(image: string, arch: string, gpu: string): boolean {
  if (!['arm64', 'aarch64'].includes(arch) || gpu !== 'nvidia') return false
  const version = officialPattern.exec(image)?.[1]
  // Do not replace custom/digest/rolling images, or downgrade a newer engine.
  return !!version && !isNewerVersion(version, NOMAD_OLLAMA_ENGINE)
}

export function nomadOllamaRelease(appVersion: string): string {
  return versionPattern.test(appVersion) && !isNewerVersion(FIRST_NOMAD_OLLAMA_RELEASE, appVersion)
    ? appVersion.replace(/^v/, '')
    : FIRST_NOMAD_OLLAMA_RELEASE
}

export function isNomadOllamaRelease(version: string): boolean {
  return versionPattern.test(version) && version.replace(/^v/, '').startsWith('1.') &&
    !isNewerVersion(FIRST_NOMAD_OLLAMA_RELEASE, version)
}

export function selectOllamaRuntimeImage(
  image: string, arch: string, gpu: string, appVersion: string, targetVersion?: string
): string {
  if (isNomadOllamaImage(image)) {
    if (!targetVersion) return image
    if (!isNomadOllamaRelease(targetVersion)) throw new Error('Invalid NOMAD Ollama runtime version')
    return `${NOMAD_OLLAMA_REPOSITORY}:${targetVersion}`
  }
  const eligible = canMigrateOllamaRuntime(image, arch, gpu)
  if (targetVersion) {
    if (eligible && isNomadOllamaRelease(targetVersion)) {
      return `${NOMAD_OLLAMA_REPOSITORY}:${targetVersion}`
    }
    const separator = image.lastIndexOf(':')
    const base = separator > image.lastIndexOf('/') ? image.slice(0, separator) : image
    return `${base}:${targetVersion}`
  }
  return eligible ? `${NOMAD_OLLAMA_REPOSITORY}:${nomadOllamaRelease(appVersion)}` : image
}

export function ollamaRuntimeEnv(image: string, arch: string, env: string[]): string[] {
  if (!isNomadOllamaImage(image) || !['arm64', 'aarch64'].includes(arch)) return env
  return [...env.filter((value) => !value.startsWith('MLX_USE_CUDA_GRAPHS=')), 'MLX_USE_CUDA_GRAPHS=0']
}
