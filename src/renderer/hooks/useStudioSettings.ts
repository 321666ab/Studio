import { useCallback, useEffect, useState } from 'react'
import type { Settings, SettingsPatch } from '../../shared/types'
import { api } from '../lib/api'

export const FALLBACK_SETTINGS: Settings = {
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
    taskTimeoutMs: 10 * 60 * 1000
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

function merge(current: Settings, patch: SettingsPatch): Settings {
  return {
    general: { ...current.general, ...(patch.general ?? {}) },
    ai: { ...current.ai, ...(patch.ai ?? {}) },
    notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
    terminal: { ...current.terminal, ...(patch.terminal ?? {}) },
    appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
    layout: { ...current.layout, ...(patch.layout ?? {}) }
  }
}

function legacyPatch(): SettingsPatch | null {
  if (localStorage.getItem('studio.settingsMigrated.v1') === '1') return null
  try {
    const appearance = JSON.parse(
      localStorage.getItem('studio.appearance.v1') ?? '{}'
    ) as Partial<Settings['appearance']>
    const panels = JSON.parse(
      localStorage.getItem('studio.panels.v1') ?? '{}'
    ) as Partial<Settings['layout']>
    const muted = localStorage.getItem('studio.terminalMuted')
    return {
      appearance,
      layout: {
        leftWidth: panels.leftWidth,
        rightWidth: panels.rightWidth
      },
      notifications: muted === null ? {} : { soundEnabled: muted !== '1' }
    }
  } catch {
    return null
  }
}

export function useStudioSettings(): {
  settings: Settings
  loading: boolean
  error: string | null
  updateSettings: (patch: SettingsPatch) => Promise<void>
  resetAllSettings: () => Promise<void>
} {
  const [settings, setSettings] = useState<Settings>(FALLBACK_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .getSettings()
      .then(async (loaded) => {
        const legacy = legacyPatch()
        const migrated = legacy ? await api.updateSettings(legacy) : loaded
        localStorage.setItem('studio.settingsMigrated.v1', '1')
        if (!cancelled) setSettings(migrated)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '读取设置失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateSettings = useCallback(async (patch: SettingsPatch) => {
    setError(null)
    setSettings((current) => merge(current, patch))
    try {
      setSettings(await api.updateSettings(patch))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存设置失败')
      setSettings(await api.getSettings().catch(() => FALLBACK_SETTINGS))
    }
  }, [])

  const resetAllSettings = useCallback(async () => {
    await updateSettings({
      ...FALLBACK_SETTINGS,
      general: {
        ...FALLBACK_SETTINGS.general,
        lastProjectPath: settings.general.lastProjectPath
      }
    })
  }, [settings.general.lastProjectPath, updateSettings])

  return { settings, loading, error, updateSettings, resetAllSettings }
}
