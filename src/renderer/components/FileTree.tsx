import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import type { DirEntry } from '../../shared/types'
import { api } from '../lib/api'

interface TreeNodeProps {
  entry: DirEntry
  depth: number
  selectedPath: string | null
  onSelectFile: (entry: DirEntry) => void
  onCopyRelativePath: (relativePath: string) => void
  onAddToAiContext: (entry: DirEntry) => void
}

/**
 * One row of the lazy tree. Directories fetch their children on first expand and
 * cache them; files report selection upward.
 */
function TreeNode({
  entry,
  depth,
  selectedPath,
  onSelectFile,
  onCopyRelativePath,
  onAddToAiContext
}: TreeNodeProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (children === null && !loading) {
      setLoading(true)
      setError(null)
      try {
        setChildren(await api.readDir(entry.path))
      } catch (e) {
        setError(e instanceof Error ? e.message : '读取文件夹失败')
      } finally {
        setLoading(false)
      }
    }
  }, [open, children, loading, entry.path])

  // Keep an expanded directory current when its listing changes on disk
  // (agents editing files from the terminal are the usual producer).
  const hasChildren = children !== null
  useEffect(() => {
    if (!open || !hasChildren) return
    return api.onFsChanged((dirs) => {
      if (!dirs.includes('*') && !dirs.includes(entry.path)) return
      void api
        .readDir(entry.path)
        .then(setChildren)
        .catch(() => undefined) // dir may have just been deleted — parent will drop us
    })
  }, [open, hasChildren, entry.path])

  const selected = selectedPath === entry.path
  const indent = 8 + depth * 14

  return (
    <>
      <div
        className={`tree-row${selected ? ' selected' : ''}`}
        style={{ paddingLeft: indent }}
        onClick={() => (entry.isDirectory ? toggle() : onSelectFile(entry))}
        onContextMenu={(event) => {
          event.preventDefault()
          void api.showPathContextMenu(entry.path).then((result) => {
            if (result?.action === 'copy-relative-path') onCopyRelativePath(result.relativePath)
            if (result?.action === 'add-ai-context') onAddToAiContext(entry)
          })
        }}
        title={entry.name}
      >
        {entry.isDirectory ? (
          <span className={`twisty${open ? ' open' : ''}`}>
            <ChevronRight size={13} strokeWidth={2.4} />
          </span>
        ) : (
          <span className="twisty" />
        )}
        <span className="ic">
          {entry.isDirectory ? (
            open ? (
              <FolderOpen size={15} strokeWidth={1.8} />
            ) : (
              <Folder size={15} strokeWidth={1.8} />
            )
          ) : (
            <File size={15} strokeWidth={1.8} />
          )}
        </span>
        <span className="label">{entry.name}</span>
      </div>

      {open && (
        <>
          {loading && (
            <div className="tree-row" style={{ paddingLeft: indent + 20, color: 'var(--text-tertiary)' }}>
              正在加载…
            </div>
          )}
          {error && (
            <div
              className="tree-row"
              style={{ paddingLeft: indent + 20, color: 'var(--status-failed)' }}
              title={error}
            >
              {error}
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onCopyRelativePath={onCopyRelativePath}
              onAddToAiContext={onAddToAiContext}
            />
          ))}
          {children?.length === 0 && (
            <div
              className="tree-row"
              style={{ paddingLeft: indent + 20, color: 'var(--text-tertiary)' }}
            >
              空文件夹
            </div>
          )}
        </>
      )}
    </>
  )
}

interface FileTreeProps {
  roots: DirEntry[]
  selectedPath: string | null
  onSelectFile: (entry: DirEntry) => void
  onCopyRelativePath: (relativePath: string) => void
  onAddToAiContext: (entry: DirEntry) => void
}

export function FileTree({
  roots,
  selectedPath,
  onSelectFile,
  onCopyRelativePath,
  onAddToAiContext
}: FileTreeProps): JSX.Element {
  return (
    <div className="tree">
      {roots.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          onCopyRelativePath={onCopyRelativePath}
          onAddToAiContext={onAddToAiContext}
        />
      ))}
    </div>
  )
}
