import type { HotkeySlot } from './types.js'

export const RECOMMENDED_HOTKEYS: HotkeySlot[] = [
  {
    id: 1,
    enabled: true,
    accelerator: 'CmdOrCtrl+Alt+1',
    action: 'focus-claude-terminal',
    presetText: ''
  },
  {
    id: 2,
    enabled: true,
    accelerator: 'CmdOrCtrl+Alt+2',
    action: 'focus-codex-terminal',
    presetText: ''
  },
  {
    id: 3,
    enabled: false,
    accelerator: 'CmdOrCtrl+Alt+3',
    action: 'paste-preset-text',
    presetText: ''
  },
  {
    id: 4,
    enabled: false,
    accelerator: 'CmdOrCtrl+Alt+4',
    action: 'paste-preset-text',
    presetText: ''
  },
  {
    id: 5,
    enabled: false,
    accelerator: 'CmdOrCtrl+Alt+5',
    action: 'paste-preset-text',
    presetText: ''
  }
]
