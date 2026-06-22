import {
  type ClipboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  Check,
  ExternalLink,
  Eye,
  FileQuestion,
  FileText,
  FileX2,
  Pencil,
  RotateCw,
  Save
} from 'lucide-react'
import type { DirEntry } from '../../shared/types'
import { api } from '../lib/api'
import { fileKind, kindLabel } from '../lib/fileKind'
import { previewUrl } from '../lib/preview'
import { htmlToMarkdown, renderMarkdown } from '../lib/markdown'

interface ViewerProps {
  file: DirEntry | null
  focused: boolean
  onOpenExternal: (path: string) => void
  onDirtyChange?: (path: string, dirty: boolean) => void
}

interface TextState {
  status: 'loading' | 'ready' | 'error'
  content: string
  savedContent: string
  truncated: boolean
  error: string
}

export function Viewer({
  file,
  focused,
  onOpenExternal,
  onDirtyChange
}: ViewerProps): JSX.Element {
  if (!file) {
    return (
      <div className="viewer">
        <div className="placeholder">
          <FileText className="ic" size={42} strokeWidth={1.4} />
          <div className="title">尚未打开文件</div>
          <div className="sub">从左侧文件栏选择文档，在当前分屏中预览。</div>
        </div>
      </div>
    )
  }

  const kind = fileKind(file.name)

  return (
    <div className="viewer">
      <div
        className={`viewer-body${kind === 'markdown' ? ' markdown-viewer-body' : ''}`}
        key={file.path}
      >
        {kind === 'pdf' && <PdfView path={file.path} />}
        {kind === 'image' && <ImageView path={file.path} name={file.name} />}
        {kind === 'quicklook' && (
          <QuickLookView file={file} onOpenExternal={onOpenExternal} />
        )}
        {(kind === 'text' || kind === 'markdown') && (
          <TextOrMarkdownView
            file={file}
            markdown={kind === 'markdown'}
            focused={focused}
            onDirtyChange={onDirtyChange}
          />
        )}
        {kind === 'office' && <QuickLookView file={file} onOpenExternal={onOpenExternal} />}
        {kind === 'other' && <GenericCard file={file} onOpenExternal={onOpenExternal} />}
      </div>
    </div>
  )
}

function PdfView({ path }: { path: string }): JSX.Element {
  return <iframe className="pdf-frame" src={previewUrl(path)} title="PDF 预览" />
}

function ImageView({ path, name }: { path: string; name: string }): JSX.Element {
  return (
    <div className="img-wrap">
      <img src={previewUrl(path)} alt={name} />
    </div>
  )
}

function TextOrMarkdownView({
  file,
  markdown,
  focused,
  onDirtyChange
}: {
  file: DirEntry
  markdown: boolean
  focused: boolean
  onDirtyChange?: (path: string, dirty: boolean) => void
}): JSX.Element {
  const [state, setState] = useState<TextState>({
    status: 'loading',
    content: '',
    savedContent: '',
    truncated: false,
    error: ''
  })
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const savedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
    setMode('preview')
    setSaveState('idle')
    setState({
      status: 'loading',
      content: '',
      savedContent: '',
      truncated: false,
      error: ''
    })
    api
      .readFile(file.path)
      .then((res) => {
        if (cancelled) return
        setState({
          status: 'ready',
          content: res.content,
          savedContent: res.content,
          truncated: res.truncated,
          error: ''
        })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          content: '',
          savedContent: '',
          truncated: false,
          error: e instanceof Error ? e.message : '读取文件失败'
        })
      })
    return () => {
      cancelled = true
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
    }
  }, [file.path])

  const html = useMemo(
    () => (markdown && state.status === 'ready' ? renderMarkdown(state.content) : ''),
    [markdown, state.status, state.content]
  )
  const dirty = state.content !== state.savedContent

  useEffect(() => {
    if (markdown) onDirtyChange?.(file.path, dirty)
  }, [dirty, file.path, markdown, onDirtyChange])

  const updateContent = useCallback((content: string) => {
    setSaveState('idle')
    setState((current) => ({ ...current, content, error: '' }))
  }, [])

  const save = useCallback(async (): Promise<void> => {
    if (!markdown || state.status !== 'ready' || state.truncated || !dirty) return
    const contentToSave = state.content
    setSaveState('saving')
    try {
      await api.writeMarkdown(file.path, contentToSave)
      setState((current) => ({ ...current, savedContent: contentToSave, error: '' }))
      setSaveState('saved')
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = window.setTimeout(() => setSaveState('idle'), 1200)
    } catch (error) {
      setSaveState('error')
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : '保存失败'
      }))
    }
  }, [dirty, file.path, markdown, state.content, state.status, state.truncated])

  useEffect(() => {
    if (!markdown || !focused) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey && event.key.toLowerCase() === 's')) return
      event.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focused, markdown, save])

  if (state.status === 'loading') {
    return (
      <div className="placeholder">
        <div className="spinner" />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="placeholder error">
        <FileX2 className="ic" size={38} strokeWidth={1.4} />
        <div className="title">无法读取文件</div>
        <div className="sub">{state.error}</div>
      </div>
    )
  }

  return (
    <>
      {markdown && (
        <div className="markdown-toolbar">
          <div className="segmented-control">
            <button
              className={mode === 'preview' ? 'active' : ''}
              onClick={() => setMode('preview')}
            >
              <Eye size={13} strokeWidth={1.9} />
              预览编辑
            </button>
            <button
              className={mode === 'edit' ? 'active' : ''}
              disabled={state.truncated}
              onClick={() => setMode('edit')}
            >
              <Pencil size={13} strokeWidth={1.9} />
              源码
            </button>
          </div>
          <span className={`save-status${dirty ? ' dirty' : ''}`}>
            {saveState === 'saving'
              ? '正在保存…'
              : saveState === 'error'
                ? state.error
                : dirty
                  ? '未保存'
                  : saveState === 'saved'
                    ? '已保存'
                    : '已同步'}
          </span>
          <button
            className="text-btn markdown-save"
            disabled={!dirty || saveState === 'saving' || state.truncated}
            onClick={() => void save()}
          >
            {saveState === 'saved' ? <Check size={14} /> : <Save size={14} />}
            保存
            <kbd>⌘S</kbd>
          </button>
        </div>
      )}
      {state.truncated && (
        <div
          style={{
            padding: '6px 14px',
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-tertiary)',
            borderBottom: '1px solid var(--line)'
          }}
        >
          文件较大，仅显示前半部分。
        </div>
      )}
      {markdown && mode === 'edit' ? (
        <textarea
          className="markdown-editor"
          value={state.content}
          spellCheck={false}
          aria-label={`${file.name} Markdown 编辑器`}
          onChange={(event) => {
            updateContent(event.currentTarget.value)
          }}
        />
      ) : markdown ? (
        <MarkdownPreviewEditor
          source={state.content}
          html={html}
          disabled={state.truncated}
          onChange={updateContent}
        />
      ) : (
        <pre className="text-view">{state.content}</pre>
      )}
    </>
  )
}

function MarkdownPreviewEditor({
  source,
  html,
  disabled,
  onChange
}: {
  source: string
  html: string
  disabled: boolean
  onChange: (content: string) => void
}): JSX.Element {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const composingRef = useRef(false)
  const localEditRef = useRef(false)
  const lastSourceRef = useRef(source)

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (localEditRef.current && lastSourceRef.current === source) {
      localEditRef.current = false
      return
    }
    if (editor.innerHTML !== html) editor.innerHTML = html
    lastSourceRef.current = source
  }, [html, source])

  const commit = (): void => {
    const editor = editorRef.current
    if (!editor || disabled) return
    const markdown = htmlToMarkdown(editor.innerHTML)
    localEditRef.current = true
    lastSourceRef.current = markdown
    onChange(markdown)
  }

  const pastePlainText = (event: ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  const blockLinkNavigation = (event: MouseEvent<HTMLDivElement>): void => {
    if ((event.target as Element).closest('a')) event.preventDefault()
  }

  return (
    <div
      ref={editorRef}
      className={`markdown markdown-preview-editor${disabled ? ' disabled' : ''}`}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-label="Markdown 预览编辑器"
      aria-multiline="true"
      spellCheck
      onClick={blockLinkNavigation}
      onInput={() => {
        if (!composingRef.current) commit()
      }}
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={() => {
        composingRef.current = false
        commit()
      }}
      onPaste={pastePlainText}
    />
  )
}

function QuickLookView({
  file,
  onOpenExternal
}: {
  file: DirEntry
  onOpenExternal: (path: string) => void
}): JSX.Element {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error'
    html: string
    error: string
    generation: number
  }>({ status: 'loading', html: '', error: '', generation: 0 })

  useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, status: 'loading', html: '', error: '' }))
    api
      .quickLook(file.path)
      .then((preview) => {
        if (!cancelled) {
          setState((current) => ({ ...current, status: 'ready', html: preview.html }))
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            status: 'error',
            error: error instanceof Error ? error.message : '快速预览失败'
          }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [file.path, state.generation])

  if (state.status === 'loading') {
    return (
      <div className="placeholder">
        <div className="spinner" />
        <div className="sub">正在生成快速预览…</div>
      </div>
    )
  }

  if (state.status === 'ready') {
    return (
      <div className="quicklook-view">
        <div className="quicklook-toolbar">
          <span>{file.name}</span>
          <button className="icon-btn" title="使用默认应用打开" onClick={() => onOpenExternal(file.path)}>
            <ExternalLink size={14} strokeWidth={1.9} />
          </button>
        </div>
        <iframe
          className="quicklook-frame"
          srcDoc={state.html}
          title={`${file.name} 的快速预览`}
          sandbox=""
        />
      </div>
    )
  }

  return (
    <div className="placeholder">
      <div className="file-card">
        <div className="badge">
          <FileText size={32} strokeWidth={1.4} />
        </div>
        <div className="name">{file.name}</div>
        <div className="meta">{state.error}</div>
        <button
          className="text-btn"
          onClick={() => setState((current) => ({ ...current, generation: current.generation + 1 }))}
        >
          <RotateCw size={14} strokeWidth={2} />
          重试预览
        </button>
        <button className="text-btn primary" onClick={() => onOpenExternal(file.path)}>
          <ExternalLink size={14} strokeWidth={2} />
          使用默认应用打开
        </button>
      </div>
    </div>
  )
}

function GenericCard({
  file,
  onOpenExternal
}: {
  file: DirEntry
  onOpenExternal: (path: string) => void
}): JSX.Element {
  return (
    <div className="placeholder">
      <div className="file-card">
        <div className="badge">
          <FileQuestion size={32} strokeWidth={1.4} />
        </div>
        <div className="name">{file.name}</div>
        <div className="meta">{kindLabel(file.name)}</div>
        <button className="text-btn" onClick={() => onOpenExternal(file.path)}>
          <ExternalLink size={14} strokeWidth={2} />
          使用默认应用打开
        </button>
      </div>
    </div>
  )
}
