import type { OutlineItem } from '../lib/outline'

interface MarkdownOutlineProps {
  items: OutlineItem[]
  activeIndex: number
  onPick: (item: OutlineItem) => void
}

/** TOC sidebar for the Markdown viewer: click a heading to jump to it. */
export function MarkdownOutline({
  items,
  activeIndex,
  onPick
}: MarkdownOutlineProps): JSX.Element {
  const minLevel = items.reduce((min, item) => Math.min(min, item.level), 6)

  return (
    <aside className="markdown-outline" aria-label="文档大纲">
      <div className="markdown-outline-title">大纲</div>
      {items.length === 0 ? (
        <div className="markdown-outline-empty">此文档没有标题。</div>
      ) : (
        <div className="markdown-outline-list" role="list">
          {items.map((item) => (
            <button
              key={item.index}
              role="listitem"
              className={item.index === activeIndex ? 'active' : ''}
              style={{ paddingLeft: 10 + (item.level - minLevel) * 12 }}
              title={item.text}
              onClick={() => onPick(item)}
            >
              {item.text}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
