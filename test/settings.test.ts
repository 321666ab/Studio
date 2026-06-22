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
  })

  it('clamps out-of-range numbers', () => {
    const result = normalizeSettings({
      appearance: { panelOpacity: 5, blur: -10 },
      terminal: { fontSize: 999 }
    })
    expect(result.appearance.panelOpacity).toBe(0.96)
    expect(result.appearance.blur).toBe(0)
    expect(result.terminal.fontSize).toBe(24)
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
      appearance: { colorScheme: 'dark' }
    })
    expect(result.ai.defaultProvider).toBe('codex')
    expect(result.ai.bypassPermissions).toBe(false)
    expect(result.appearance.colorScheme).toBe('dark')
  })
})

describe('mergeSettings', () => {
  it('overlays a partial patch and re-normalizes', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      ai: { bypassPermissions: false },
      layout: { leftWidth: 300 }
    })
    expect(merged.ai.bypassPermissions).toBe(false)
    expect(merged.ai.defaultProvider).toBe('claude')
    expect(merged.layout.leftWidth).toBe(300)
    expect(merged.layout.rightWidth).toBe(DEFAULT_SETTINGS.layout.rightWidth)
  })

  it('clamps patched values', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { layout: { leftWidth: 9999 } })
    expect(merged.layout.leftWidth).toBe(460)
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
