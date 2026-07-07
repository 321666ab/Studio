import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, FileText, Search } from 'lucide-react'
import type { ProjectFileEntry } from '../../shared/types'
import { api } from '../lib/api'
import { type FuzzyMatch, rankFuzzy } from '../lib/fuzzy'
import { getRecentFiles } from '../lib/recentFiles'

const RESULT_LIMIT = 50
/** Score bonus for the most recently opened file; decays by recency rank. */
const RECENT_BOOST_MAX = 14

interface QuickOpenProps {
  open: boolean
  projectRoot: string | null
  onPick: (entry: ProjectFileEntry) => void
  onClose: () => void
}

interface ResultRow {
  item: ProjectFileEntry
  match: FuzzyMatch
  recent: boolean
}

/**
 * ⌘P quick-open palette: fuzzy-search every file in the project and open the
 * selection in the document workspace. The file list is fetched fresh each
 * time the palette opens; recently opened files surface first.
 */
export function QuickOpen({ open, projectRoot, onPick, onClose }: QuickOpenProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<ProjectFileEntry[]>([])
  const [recents, setRecents] = useState<ProjectFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    setError(null)
    inputRef.current?.focus()
    if (!projectRoot) return
    setRecents(getRecentFiles(projectRoot))
    let cancelled = false
    setLoading(true)
    api
      .listProjectFiles()
      .then((entries) => {
        if (!cancelled) setFiles(entries)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '无法读取文件列表')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, projectRoot])

  const results = useMemo<ResultRow[]>(() => {
    // Drop recents that no longer exist in the project (once the scan is in).
    const known = files.length > 0 ? new Set(files.map((file) => file.path)) : null
    const validRecents = known ? recents.filter((item) => known.has(item.path)) : recents

    if (!query.trim()) {
      const emptyMatch: FuzzyMatch = { score: 0, positions: [] }
      const recentPaths = new Set(validRecents.map((item) => item.path))
      const recentRows = validRecents.map((item) => ({ item, match: emptyMatch, recent: true }))
      const rest = files
        .filter((file) => !recentPaths.has(file.path))
        .slice(0, Math.max(0, RESULT_LIMIT - recentRows.length))
        .map((item) => ({ item, match: emptyMatch, recent: false }))
      return [...recentRows, ...rest]
    }

    const boostByPath = new Map(
      validRecents.map((item, index) => [item.path, RECENT_BOOST_MAX - index])
    )
    return rankFuzzy(
      query.trim(),
      files,
      (item) => item.relativePath,
      RESULT_LIMIT,
      (item) => boostByPath.get(item.path) ?? 0
    ).map(({ item, match }) => ({ item, match, recent: boostByPath.has(item.path) }))
  }, [files, query, recents])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const pick = useCallback(
    (entry: ProjectFileEntry) => {
      onPick(entry)
      onClose()
    },
    [onClose, onPick]
  )

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!results.length) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const next = (activeIndex + delta + results.length) % results.length
      setActiveIndex(next)
      listRef.current
        ?.querySelector(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const target = results[activeIndex]
      if (target) pick(target.item)
    }
  }

  if (!open) return null

  const hasProject = projectRoot !== null
  const showSections = !query.trim() && results.some((row) => row.recent)

  return (
    <div className="quick-open-backdrop" onMouseDown={onClose}>
      <div
        className="quick-open-panel"
        role="dialog"
        aria-label="快速打开文件"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="quick-open-field">
          <Search size={15} strokeWidth={1.9} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={hasProject ? '按文件名搜索…' : '先打开一个项目文件夹'}
            spellCheck={false}
            disabled={!hasProject}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {loading && <span className="quick-open-loading">扫描中…</span>}
        </div>

        <div className="quick-open-list" ref={listRef} role="listbox">
          {!hasProject ? (
            <div className="quick-open-empty">打开项目后即可用 ⌘P 搜索文件。</div>
          ) : error ? (
            <div className="quick-open-empty">{error}</div>
          ) : results.length === 0 ? (
            <div className="quick-open-empty">
              {loading ? '正在扫描项目文件…' : '没有匹配的文件'}
            </div>
          ) : (
            results.map(({ item, match, recent }, index) => (
              <div key={item.path}>
                {showSections && index === 0 && recent && (
                  <div className="quick-open-section">最近打开</div>
                )}
                {showSections && !recent && (results[index - 1]?.recent ?? false) && (
                  <div className="quick-open-section">全部文件</div>
                )}
                <div
                  data-index={index}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`quick-open-item${index === activeIndex ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(item)}
                >
                  {recent ? (
                    <Clock3 size={14} strokeWidth={1.8} />
                  ) : (
                    <FileText size={14} strokeWidth={1.8} />
                  )}
                  <span className="quick-open-path">
                    {highlight(item.relativePath, match.positions)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="quick-open-foot">
          <span>↑↓ 选择</span>
          <span>↩ 打开</span>
          <span>esc 关闭</span>
        </div>
      </div>
    </div>
  )
}

/** Render the path with matched characters emphasized. */
function highlight(text: string, positions: number[]): JSX.Element {
  if (positions.length === 0) return <>{text}</>
  const marked = new Set(positions)
  const parts: JSX.Element[] = []
  let run = ''
  let runMarked = marked.has(0)
  for (let i = 0; i <= text.length; i += 1) {
    const isMarked = i < text.length ? marked.has(i) : !runMarked
    if (i === text.length || isMarked !== runMarked) {
      if (run) {
        parts.push(
          runMarked ? <mark key={parts.length}>{run}</mark> : <span key={parts.length}>{run}</span>
        )
      }
      run = ''
      runMarked = isMarked
    }
    if (i < text.length) run += text[i]
  }
  return <>{parts}</>
}
