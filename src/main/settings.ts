import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import type {
  AgentProvider,
  ColorScheme,
  Settings,
  SettingsPatch
} from '../shared/types.js'

/**
 * On-disk envelope. The version lets us migrate older documents forward
 * without losing user data when the schema evolves.
 */
export const SETTINGS_VERSION = 1

interface SettingsFile {
  version: number
  settings: Settings
}

export const DEFAULT_SETTINGS: Settings = {
  general: {
    restoreLastProject: true,
    lastProjectPath: null,
    confirmBeforeDiscard: true
  },
  ai: {
    defaultProvider: 'claude',
    claudeModel: '',
    codexModel: '',
    bypassPermissions: true,
    taskTimeoutMs: 10 * 60 * 1000,
    maxBudgetUsd: 2
  },
  notifications: {
    notifyOnTaskComplete: true,
    notifyOnTaskError: true,
    soundEnabled: false
  },
  terminal: {
    fontSize: 13,
    scrollback: 5000
  },
  appearance: {
    colorScheme: 'system',
    panelOpacity: 0.64,
    blur: 32,
    animationMs: 180,
    radius: 12,
    inset: 7
  },
  layout: {
    leftWidth: 280,
    rightWidth: 320
  }
}

const PROVIDERS: readonly AgentProvider[] = ['claude', 'codex']
const COLOR_SCHEMES: readonly ColorScheme[] = ['system', 'light', 'dark']

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asNullableString(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value : value === null ? null : fallback
}

function asShortString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length <= 120 ? value.trim() : fallback
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * Coerce an arbitrary (possibly partial or malformed) object into a complete,
 * range-checked Settings document. Unknown keys are dropped and every field is
 * validated against the defaults so a corrupt file can never crash the app.
 */
export function normalizeSettings(input: unknown): Settings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const general = (raw.general ?? {}) as Record<string, unknown>
  const ai = (raw.ai ?? {}) as Record<string, unknown>
  const notifications = (raw.notifications ?? {}) as Record<string, unknown>
  const terminal = (raw.terminal ?? {}) as Record<string, unknown>
  const appearance = (raw.appearance ?? {}) as Record<string, unknown>
  const layout = (raw.layout ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS

  return {
    general: {
      restoreLastProject: asBoolean(general.restoreLastProject, d.general.restoreLastProject),
      lastProjectPath: asNullableString(general.lastProjectPath, d.general.lastProjectPath),
      confirmBeforeDiscard: asBoolean(general.confirmBeforeDiscard, d.general.confirmBeforeDiscard)
    },
    ai: {
      defaultProvider: asEnum(ai.defaultProvider, PROVIDERS, d.ai.defaultProvider),
      claudeModel: asShortString(ai.claudeModel, d.ai.claudeModel),
      codexModel: asShortString(ai.codexModel, d.ai.codexModel),
      bypassPermissions: asBoolean(ai.bypassPermissions, d.ai.bypassPermissions),
      taskTimeoutMs: clampNumber(ai.taskTimeoutMs, d.ai.taskTimeoutMs, 10_000, 60 * 60 * 1000),
      maxBudgetUsd: clampNumber(ai.maxBudgetUsd, d.ai.maxBudgetUsd, 0, 100)
    },
    notifications: {
      notifyOnTaskComplete: asBoolean(
        notifications.notifyOnTaskComplete,
        d.notifications.notifyOnTaskComplete
      ),
      notifyOnTaskError: asBoolean(
        notifications.notifyOnTaskError,
        d.notifications.notifyOnTaskError
      ),
      soundEnabled: asBoolean(notifications.soundEnabled, d.notifications.soundEnabled)
    },
    terminal: {
      fontSize: clampNumber(terminal.fontSize, d.terminal.fontSize, 9, 24),
      scrollback: clampNumber(terminal.scrollback, d.terminal.scrollback, 200, 100_000)
    },
    appearance: {
      colorScheme: asEnum(appearance.colorScheme, COLOR_SCHEMES, d.appearance.colorScheme),
      panelOpacity: clampNumber(appearance.panelOpacity, d.appearance.panelOpacity, 0.35, 0.96),
      blur: clampNumber(appearance.blur, d.appearance.blur, 0, 72),
      animationMs: clampNumber(appearance.animationMs, d.appearance.animationMs, 80, 360),
      radius: clampNumber(appearance.radius, d.appearance.radius, 6, 20),
      inset: clampNumber(appearance.inset, d.appearance.inset, 0, 14)
    },
    layout: {
      leftWidth: clampNumber(layout.leftWidth, d.layout.leftWidth, 200, 460),
      rightWidth: clampNumber(layout.rightWidth, d.layout.rightWidth, 240, 520)
    }
  }
}

/**
 * Merge a deep-partial patch over the current settings, then re-normalize so the
 * result is always valid. Only known top-level sections are merged.
 */
export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const next: Settings = {
    general: { ...current.general, ...(patch.general ?? {}) },
    ai: { ...current.ai, ...(patch.ai ?? {}) },
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
    terminal: { ...current.terminal, ...(patch.terminal ?? {}) },
    appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
    layout: { ...current.layout, ...(patch.layout ?? {}) }
  }
  return normalizeSettings(next)
}

/**
 * Migrate a parsed settings file forward to the current version. Today there is
 * only v1; the seam exists so future versions can transform older shapes before
 * normalization.
 */
export function migrateSettingsFile(parsed: unknown): Settings {
  const file = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<SettingsFile>
  // Future migrations switch on file.version here.
  return normalizeSettings(file.settings ?? parsed)
}

/**
 * Owns the persisted settings document. Reads lazily on first access, caches in
 * memory, and writes atomically (temp file + rename) so a crash mid-write can
 * never leave a truncated file.
 */
export class SettingsStore {
  private cache: Settings | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async get(): Promise<Settings> {
    if (this.cache) return this.cache
    this.cache = await this.load()
    return this.cache
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    const current = await this.get()
    const next = mergeSettings(current, patch)
    this.cache = next
    await this.persist(next)
    return next
  }

  private async load(): Promise<Settings> {
    try {
      const text = await fs.readFile(this.filePath, 'utf-8')
      return migrateSettingsFile(JSON.parse(text))
    } catch {
      // Missing or corrupt file: fall back to defaults (and let the next write
      // materialize a clean document).
      return normalizeSettings({})
    }
  }

  /**
   * Serialize writes so concurrent update() calls cannot interleave temp-file
   * renames. Each write goes to a unique temp path then atomically renames.
   */
  private persist(settings: Settings): Promise<void> {
    const payload: SettingsFile = { version: SETTINGS_VERSION, settings }
    const text = `${JSON.stringify(payload, null, 2)}\n`
    this.writeChain = this.writeChain.then(() => atomicWrite(this.filePath, text))
    return this.writeChain
  }
}

/** Write `text` to `filePath` atomically via a sibling temp file + rename. */
async function atomicWrite(filePath: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomToken()}.tmp`
  )
  await fs.writeFile(tmp, text, 'utf-8')
  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

/** A short token to disambiguate concurrent temp files (not security-sensitive). */
let tokenCounter = 0
function randomToken(): string {
  tokenCounter = (tokenCounter + 1) >>> 0
  return `${tokenCounter.toString(36)}${process.hrtime.bigint().toString(36)}`
}

/** Default settings file location under the OS user-config directory. */
export function defaultSettingsPath(userDataDir: string = path.join(os.homedir(), '.studio')): string {
  return path.join(userDataDir, 'settings.json')
}
