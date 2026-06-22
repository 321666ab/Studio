import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AgentAvailability, AgentProvider } from '../shared/types.js'

const execFileAsync = promisify(execFile)

/** CLI binary name for each provider. */
const PROVIDER_BINARY: Record<AgentProvider, string> = {
  claude: 'claude',
  codex: 'codex'
}

/**
 * Resolve whether a provider's CLI is installed and, when possible, its path
 * and version. We probe through a login shell so the user's PATH (nvm, brew,
 * etc.) is honored the same way the terminal sees it.
 */
export async function detectAgent(provider: AgentProvider): Promise<AgentAvailability> {
  const binary = PROVIDER_BINARY[provider]
  const resolvedPath = await which(binary)
  if (!resolvedPath) {
    return { provider, available: false }
  }
  const version = await probeVersion(resolvedPath)
  return { provider, available: true, path: resolvedPath, version }
}

/** Detect all known providers concurrently. */
export async function detectAllAgents(): Promise<AgentAvailability[]> {
  const providers: AgentProvider[] = ['claude', 'codex']
  return Promise.all(providers.map((provider) => detectAgent(provider)))
}

/** Locate a binary on PATH using a login shell, returning its absolute path. */
async function which(binary: string): Promise<string | undefined> {
  const shell = process.env.SHELL || '/bin/bash'
  try {
    const { stdout } = await execFileAsync(shell, ['-l', '-c', `command -v ${binary}`], {
      timeout: 5000
    })
    const first = stdout.split('\n').map((line) => line.trim()).find(Boolean)
    return first || undefined
  } catch {
    return undefined
  }
}

/** Best-effort `--version`; absence is not fatal to availability. */
async function probeVersion(binaryPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version'], { timeout: 5000 })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Caches detection results for a short window so repeated UI queries do not
 * spawn a shell every time. Call invalidate() to force a re-probe.
 */
export class AgentAvailabilityCache {
  private cached: Promise<AgentAvailability[]> | null = null
  private cachedAt = 0

  constructor(private readonly ttlMs = 30_000) {}

  get(now: number): Promise<AgentAvailability[]> {
    if (this.cached && now - this.cachedAt < this.ttlMs) return this.cached
    this.cachedAt = now
    this.cached = detectAllAgents()
    return this.cached
  }

  invalidate(): void {
    this.cached = null
    this.cachedAt = 0
  }
}
