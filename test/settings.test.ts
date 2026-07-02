import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  migrateSettingsFile,
  normalizeSettings
} from '../src/main/settings.js'

describe('normalizeSettings', () => {
  it('returns defaults for empty/invalid input', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
  })

  it('defaults provider to claude and bypass to true', () => {
    expect(DEFAULT_SETTINGS.ai.defaultProvider).toBe('claude')
    expect(DEFAULT_SETTINGS.ai.bypassPermissions).toBe(true)
    expect(DEFAULT_SETTINGS.terminal.autoPastePath).toBe(false)
    expect(DEFAULT_SETTINGS.hotkeys).toHaveLength(5)
    expect(DEFAULT_SETTINGS.hotkeys[0]).toMatchObject({
      enabled: true,
      accelerator: 'CmdOrCtrl+Alt+1',
      action: 'focus-claude-terminal'
    })
    expect(DEFAULT_SETTINGS.hotkeys[1]).toMatchObject({
      enabled: true,
      accelerator: 'CmdOrCtrl+Alt+2',
      action: 'focus-codex-terminal'
    })
  })

  it('clamps out-of-range numbers', () => {
    const result = normalizeSettings({
      appearance: { panelOpacity: 5, blur: -10 },
      terminal: { fontSize: 999, autoPastePath: 'yes' }
    })
    expect(result.appearance.panelOpacity).toBe(0.96)
    expect(result.appearance.blur).toBe(0)
    expect(result.terminal.fontSize).toBe(24)
    expect(result.terminal.autoPastePath).toBe(false)
  })

  it('rejects unknown enum values, falling back to default', () => {
    const result = normalizeSettings({
      ai: { defaultProvider: 'gpt' },
      appearance: { colorScheme: 'neon' }
    })
    expect(result.ai.defaultProvider).toBe('claude')
    expect(result.appearance.colorScheme).toBe('system')
  })

  it('accepts valid values', () => {
    const result = normalizeSettings({
      ai: { defaultProvider: 'codex', bypassPermissions: false },
      terminal: { autoPastePath: true },
      appearance: { colorScheme: 'dark' }
    })
    expect(result.ai.defaultProvider).toBe('codex')
    expect(result.ai.bypassPermissions).toBe(false)
    expect(result.terminal.autoPastePath).toBe(true)
    expect(result.appearance.colorScheme).toBe('dark')
  })

  it('defaults the tasks workspace to enabled and accepts disabling it', () => {
    expect(DEFAULT_SETTINGS.ai.tasksEnabled).toBe(true)
    expect(normalizeSettings({}).ai.tasksEnabled).toBe(true)
    expect(normalizeSettings({ ai: { tasksEnabled: false } }).ai.tasksEnabled).toBe(false)
    expect(normalizeSettings({ ai: { tasksEnabled: 'no' } }).ai.tasksEnabled).toBe(true)
  })

  it('normalizes terminal typography settings', () => {
    expect(DEFAULT_SETTINGS.terminal.lineHeight).toBe(1.4)
    expect(DEFAULT_SETTINGS.terminal.letterSpacing).toBe(0)
    expect(DEFAULT_SETTINGS.terminal.fontFamily).toBe('')

    const result = normalizeSettings({
      terminal: { fontFamily: 'JetBrains Mono', lineHeight: 1.6, letterSpacing: 1 }
    })
    expect(result.terminal.fontFamily).toBe('JetBrains Mono')
    expect(result.terminal.lineHeight).toBe(1.6)
    expect(result.terminal.letterSpacing).toBe(1)

    const clamped = normalizeSettings({
      terminal: { fontFamily: 42, lineHeight: 9, letterSpacing: -4 }
    })
    expect(clamped.terminal.fontFamily).toBe('')
    expect(clamped.terminal.lineHeight).toBe(2)
    expect(clamped.terminal.letterSpacing).toBe(0)
  })

  it('normalizes hotkeys and disables invalid or duplicate accelerators', () => {
    const result = normalizeSettings({
      hotkeys: [
        {
          enabled: true,
          accelerator: 'CmdOrCtrl+Shift+1',
          action: 'focus-claude-terminal'
        },
        {
          enabled: true,
          accelerator: 'CmdOrCtrl+Shift+1',
          action: 'focus-codex-terminal'
        },
        {
          enabled: true,
          accelerator: 'not-valid',
          action: 'paste-preset-text',
          presetText: 'hello'
        }
      ]
    })
    expect(result.hotkeys[0]).toMatchObject({
      enabled: true,
      accelerator: 'CmdOrCtrl+Shift+1',
      action: 'focus-claude-terminal'
    })
    expect(result.hotkeys[1].enabled).toBe(false)
    expect(result.hotkeys[2]).toMatchObject({
      enabled: false,
      presetText: 'hello'
    })
  })

  it('accepts physical-key hotkeys for symbol and numpad keys', () => {
    const result = normalizeSettings({
      hotkeys: [
        {
          enabled: true,
          accelerator: 'CmdOrCtrl+Shift+Equal',
          action: 'focus-claude-terminal'
        },
        {
          enabled: true,
          accelerator: 'CmdOrCtrl+Num1',
          action: 'focus-codex-terminal'
        }
      ]
    })

    expect(result.hotkeys[0].enabled).toBe(true)
    expect(result.hotkeys[1].enabled).toBe(true)
  })
})

describe('mergeSettings', () => {
  it('overlays a partial patch and re-normalizes', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      ai: { bypassPermissions: false },
      layout: { leftWidth: 300 },
      terminal: { autoPastePath: true },
      hotkeys: [
        {
          enabled: true,
          accelerator: 'CmdOrCtrl+1',
          action: 'focus-claude-terminal'
        }
      ]
    })
    expect(merged.ai.bypassPermissions).toBe(false)
    expect(merged.ai.defaultProvider).toBe('claude')
    expect(merged.layout.leftWidth).toBe(300)
    expect(merged.layout.rightWidth).toBe(DEFAULT_SETTINGS.layout.rightWidth)
    expect(merged.terminal.autoPastePath).toBe(true)
    expect(merged.hotkeys[0].enabled).toBe(true)
    expect(merged.hotkeys[1]).toEqual(DEFAULT_SETTINGS.hotkeys[1])
  })

  it('merges the tasksEnabled toggle without touching other ai fields', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { ai: { tasksEnabled: false } })
    expect(merged.ai.tasksEnabled).toBe(false)
    expect(merged.ai.defaultProvider).toBe(DEFAULT_SETTINGS.ai.defaultProvider)
    expect(merged.ai.bypassPermissions).toBe(DEFAULT_SETTINGS.ai.bypassPermissions)
  })

  it('clamps patched values', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { layout: { leftWidth: 9999 } })
    expect(merged.layout.leftWidth).toBe(1200)
  })

  it('ignores unknown top-level sections', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { bogus: { x: 1 } } as never)
    expect(merged).toEqual(DEFAULT_SETTINGS)
  })
})

describe('migrateSettingsFile', () => {
  it('reads the v1 envelope', () => {
    const parsed = migrateSettingsFile({
      version: 1,
      settings: { ai: { defaultProvider: 'codex' } }
    })
    expect(parsed.ai.defaultProvider).toBe('codex')
  })

  it('tolerates a bare settings object without envelope', () => {
    const parsed = migrateSettingsFile({ ai: { bypassPermissions: false } })
    expect(parsed.ai.bypassPermissions).toBe(false)
  })
})
