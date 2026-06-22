import { useCallback, useEffect, useState } from 'react'

export interface AppearanceSettings {
  panelOpacity: number
  blur: number
  animationMs: number
  radius: number
  inset: number
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  panelOpacity: 0.64,
  blur: 32,
  animationMs: 180,
  radius: 12,
  inset: 7
}

const STORAGE_KEY = 'studio.appearance.v1'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function load(): AppearanceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AppearanceSettings>
    return {
      panelOpacity: clamp(saved.panelOpacity ?? DEFAULT_APPEARANCE.panelOpacity, 0.35, 0.96),
      blur: clamp(saved.blur ?? DEFAULT_APPEARANCE.blur, 0, 72),
      animationMs: clamp(saved.animationMs ?? DEFAULT_APPEARANCE.animationMs, 80, 360),
      radius: clamp(saved.radius ?? DEFAULT_APPEARANCE.radius, 6, 20),
      inset: clamp(saved.inset ?? DEFAULT_APPEARANCE.inset, 0, 14)
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function useAppearance(): {
  appearance: AppearanceSettings
  updateAppearance: (patch: Partial<AppearanceSettings>) => void
  resetAppearance: () => void
} {
  const [appearance, setAppearance] = useState<AppearanceSettings>(load)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance))
  }, [appearance])

  const updateAppearance = useCallback((patch: Partial<AppearanceSettings>) => {
    setAppearance((current) => ({ ...current, ...patch }))
  }, [])

  const resetAppearance = useCallback(() => setAppearance(DEFAULT_APPEARANCE), [])

  return { appearance, updateAppearance, resetAppearance }
}
