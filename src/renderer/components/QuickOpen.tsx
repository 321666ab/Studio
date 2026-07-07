import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, FileSearch, FileText, Search } from 'lucide-react'
import type { ContentSearchMatch, ContentSearchResult, ProjectFileEntry } from '../../shared/types'
import { api } from '../lib/api'
import { type FuzzyMatch, rankFuzzy } from '../lib/fuzzy'
import { getRecentFiles } from '../lib/recentFiles'

const RESULT_LIMIT = 50
/** Score bonus for the most recently opened file; decays by recency rank. */
const RECENT_BOOST_MAX = 14
/** Content search fires this long after the user stops typing. */
const CONTENT_SEARCH_DEBOUNCE_MS = 250
/** Content search needs at least this many characters to run. */
const CONTENT_SEARCH_MIN_QUERY = 2

export type QuickOpenMode = 'files' | 'content'

interface QuickOpenProps {
  open: boolean
  mode: QuickOpenMode
  projectRoot: string | null
  onModeChange: (mode: QuickOpenMode) => void
  onPick: (entry: ProjectFileEntry) => void
  onClose: () => void
}

interface ResultRow {
  item: ProjectFileEntry
  match: FuzzyMatch
  recent: boolean
}

/**
 * Command palette with two modes: ⌘P fuzzy-searches file names, ⌘⇧F searches
 * file contents project-wide (debounced, in the main process). Either way the
 * selection opens in the document workspace. The file list is fetched fresh
 * each time the palette opens; recently opened files surface first.
 */
export function QuickOpen({
  open,
  mode,
  projectRoot,
  onModeChange,
  onPick,
  onClose
}: QuickOpenProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<ProjectFileEntry[]>([])
  const [recents, setRecents] = useState<ProjectFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contentResult, setContentResult] = useState<ContentSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const searchSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    setError(null)
    setContentResult(null)
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

  // Keep focus in the field when the mode is switched via hotkey or tab click.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [mode, open])

  // Debounced project-wide content search.
  useEffect(() => {
    if (!open || mode !== 'content' || !projectRoot) return
    const trimmed = query.trim()
    if (trimmed.length < CONTENT_SEARCH_MIN_QUERY) {
      setContentResult(null)
      setSearching(false)
      return
    }
    const seq = (searchSeq.current += 1)
    setSearching(true)
    const timer = window.setTimeout(() => {
      api
        .searchProjectContent(trimmed)
        .then((result) => {
          if (searchSeq.current !== seq) return
          setError(null)
          setContentResult(result)
          setActiveIndex(0)
        })
        .catch((e) => {
          if (searchSeq.current !== seq) return
          setError(e instanceof Error ? e.message : '搜索失败')
        })
        .finally(() => {
          if (searchSeq.current === seq) setSearching(false)
        })
    }, CONTENT_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [mode, open, projectRoot, query])

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

  const contentMatches = contentResult?.matches ?? []
  const rowCount = mode === 'files' ? results.length : contentMatches.length

  useEffect(() => {
    setActiveIndex(0)
  }, [query, mode])

  const pick = useCallback(
    (entry: ProjectFileEntry) => {
      onPick(entry)
      onClose()
    },
    [onClose, onPick]
  )

  const pickContentMatch = useCallback(
    (match: ContentSearchMatch) => {
      pick({
        name: match.relativePath.split('/').pop() ?? match.relativePath,
        path: match.path,
        relativePath: match.relativePath
      })
    },
    [pick]
  )

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!rowCount) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const next = (activeIndex + delta + rowCount) % rowCount
      setActiveIndex(next)
      listRef.current
        ?.querySelector(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (mode === 'files') {
        const target = results[activeIndex]
        if (target) pick(target.item)
      } else {
        const target = contentMatches[activeIndex]
        if (target) pickContentMatch(target)
      }
    }
  }

  if (!open) return null

  const hasProject = projectRoot !== null
  const showSections = mode === 'files' && !query.trim() && results.some((row) => row.recent)
  const contentIdle = query.trim().length < CONTENT_SEARCH_MIN_QUERY

  return (
    <div className="quick-open-backdrop" onMouseDown={onClose}>
      <div
        className="quick-open-panel"
        role="dialog"
        aria-label={mode === 'files' ? '快速打开文件' : '搜索项目内容'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="quick-open-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'files'}
            className={`quick-open-tab${mode === 'files' ? ' active' : ''}`}
            onClick={() => onModeChange('files')}
          >
            <FileText size={13} strokeWidth={1.9} />
            文件 <kbd>⌘P</kbd>
          </button>
          <button
            role="tab"
            aria-selected={mode === 'content'}
            className={`quick-open-tab${mode === 'content' ? ' active' : ''}`}
            onClick={() => onModeChange('content')}
          >
            <FileSearch size={13} strokeWidth={1.9} />
            内容 <kbd>⇧⌘F</kbd>
          </button>
        </div>

        <div className="quick-open-field">
          <Search size={15} strokeWidth={1.9} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={
              !hasProject
                ? '先打开一个项目文件夹'
                : mode === 'files'
                  ? '按文件名搜索…'
                  : '搜索所有文档内容…'
            }
            spellCheck={false}
            disabled={!hasProject}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {(loading || searching) && <span className="quick-open-loading">扫描中…</span>}
        </div>

        <div className="quick-open-list" ref={listRef} role="listbox">
          {!hasProject ? (
            <div className="quick-open-empty">打开项目后即可用 ⌘P / ⇧⌘F 搜索。</div>
          ) : error ? (
            <div className="quick-open-empty">{error}</div>
          ) : mode === 'files' ? (
            results.length === 0 ? (
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
            )
          ) : contentIdle ? (
            <div className="quick-open-empty">输入至少 {CONTENT_SEARCH_MIN_QUERY} 个字符开始搜索。</div>
          ) : contentMatches.length === 0 ? (
            <div className="quick-open-empty">
              {searching ? '正在搜索项目内容…' : '没有匹配的内容'}
            </div>
          ) : (
            <>
              {contentResult?.truncated && (
                <div className="quick-open-section">
                  匹配过多，仅显示前 {contentMatches.length} 条
                </div>
              )}
              {contentMatches.map((match, index) => (
                <div
                  key={`${match.path}:${match.line}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`quick-open-item content${index === activeIndex ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pickContentMatch(match)}
                >
                  <div className="quick-open-match-head">
                    <FileText size={13} strokeWidth={1.8} />
                    <span className="quick-open-path">{match.relativePath}</span>
                    <span className="quick-open-line">:{match.line}</span>
                  </div>
                  <div className="quick-open-match-line">
                    <span>{match.lineText.slice(0, match.matchStart)}</span>
                    <mark>{match.lineText.slice(match.matchStart, match.matchEnd)}</mark>
                    <span>{match.lineText.slice(match.matchEnd)}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="quick-open-foot">
          <span>↑↓ 选择</span>
          <span>↩ 打开</span>
          <span>esc 关闭</span>
          {mode === 'content' && contentResult && !contentIdle && (
            <span className="quick-open-foot-stat">
              {contentMatches.length} 个匹配 · 扫描 {contentResult.filesScanned} 个文件
            </span>
          )}
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
