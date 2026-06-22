import { RotateCcw, X } from 'lucide-react'
import type { AppearanceSettings } from '../hooks/useAppearance'

interface SettingsPanelProps {
  open: boolean
  appearance: AppearanceSettings
  leftWidth: number
  rightWidth: number
  onAppearanceChange: (patch: Partial<AppearanceSettings>) => void
  onLeftWidthChange: (value: number) => void
  onRightWidthChange: (value: number) => void
  onReset: () => void
  onClose: () => void
}

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: SliderRowProps): JSX.Element {
  return (
    <label className="setting-row">
      <span className="setting-label">
        <span>{label}</span>
        <output>{suffix === '%' ? Math.round(value * 100) : Math.round(value)}{suffix}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

export function SettingsPanel({
  open,
  appearance,
  leftWidth,
  rightWidth,
  onAppearanceChange,
  onLeftWidthChange,
  onRightWidthChange,
  onReset,
  onClose
}: SettingsPanelProps): JSX.Element | null {
  if (!open) return null

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="外观设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-head">
          <div>
            <strong>侧栏外观</strong>
            <span>透明效果、动画和尺寸</span>
          </div>
          <button className="icon-btn" title="关闭设置" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <div className="settings-content">
          <SliderRow
            label="透明度"
            value={appearance.panelOpacity}
            min={0.35}
            max={0.96}
            step={0.01}
            suffix="%"
            onChange={(panelOpacity) => onAppearanceChange({ panelOpacity })}
          />
          <SliderRow
            label="背景模糊"
            value={appearance.blur}
            min={0}
            max={72}
            step={1}
            suffix=" px"
            onChange={(blur) => onAppearanceChange({ blur })}
          />
          <SliderRow
            label="过渡动画"
            value={appearance.animationMs}
            min={80}
            max={360}
            step={10}
            suffix=" ms"
            onChange={(animationMs) => onAppearanceChange({ animationMs })}
          />
          <SliderRow
            label="文件栏宽度"
            value={leftWidth}
            min={200}
            max={460}
            step={4}
            suffix=" px"
            onChange={onLeftWidthChange}
          />
          <SliderRow
            label="右侧栏宽度"
            value={rightWidth}
            min={240}
            max={520}
            step={4}
            suffix=" px"
            onChange={onRightWidthChange}
          />
        </div>

        <footer className="settings-foot">
          <button className="text-btn" onClick={onReset}>
            <RotateCcw size={14} />
            恢复默认值
          </button>
        </footer>
      </section>
    </div>
  )
}
