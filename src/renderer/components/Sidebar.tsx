import { useEffect, useRef, useState } from 'react'
import { FolderInput, PanelLeftClose, Settings } from 'lucide-react'
import type { DirEntry, ProjectInfo } from '../../shared/types'
import { FileTree } from './FileTree'
import fable5Sidebar from '../assets/fable-5-sidebar.png'

interface SidebarProps {
  project: ProjectInfo | null
  roots: DirEntry[]
  loading: boolean
  error: string | null
  selectedPath: string | null
  onOpenProject: () => void
  onSelectFile: (entry: DirEntry) => void
  onCopyRelativePath: (relativePath: string) => void
  onAddToAiContext: (entry: DirEntry) => void
  onCollapse: () => void
  onOpenSettings: () => void
}

export function Sidebar({
  project,
  roots,
  loading,
  error,
  selectedPath,
  onOpenProject,
  onSelectFile,
  onCopyRelativePath,
  onAddToAiContext,
  onCollapse,
  onOpenSettings
}: SidebarProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [hideVisual, setHideVisual] = useState(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let frame = 0

    // Max space the illustration reclaims when hidden (flex-basis 172 +
    // margin 4 + slack). Re-showing must leave the tree fitting even after
    // this space is given back, otherwise show/hide oscillates and flickers.
    // Content height is measured from the last row's bottom edge rather than
    // scrollHeight, because scrollHeight is clamped to clientHeight and can
    // never report "content much smaller than the viewport".
    const VISUAL_SPACE = 184
    const TREE_PAD_BOTTOM = 22

    const update = (): void => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const tree = root.querySelector<HTMLElement>('.tree')
        const last = tree?.lastElementChild
        if (!tree || !last) {
          setHideVisual(false)
          return
        }
        const contentHeight =
          last.getBoundingClientRect().bottom -
          tree.getBoundingClientRect().top +
          tree.scrollTop +
          TREE_PAD_BOTTOM
        setHideVisual((hidden) =>
          hidden
            ? contentHeight > tree.clientHeight - VISUAL_SPACE
            : contentHeight > tree.clientHeight + 8
        )
      })
    }

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(root)
    const tree = root.querySelector<HTMLElement>('.tree')
    if (tree) resizeObserver.observe(tree)
    const mutationObserver = new MutationObserver(update)
    mutationObserver.observe(root, { childList: true, subtree: true })
    update()

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [project?.root, roots])

  return (
    <div className="sidebar-inner" ref={rootRef}>
      <div className="section-head">
        <span className="section-title" title={project?.name ?? 'Studio'}>
          {project?.name ?? 'Studio'}
        </span>
        <span className="spacer" />
        <button className="icon-btn" title="打开文件夹…" onClick={onOpenProject}>
          <FolderInput size={15} strokeWidth={1.8} />
        </button>
        <button className="icon-btn" title="收起文件栏 (⌘B)" onClick={onCollapse}>
          <PanelLeftClose size={15} strokeWidth={1.8} />
        </button>
      </div>

      {!project ? (
        <div className="placeholder">
          <div className="title">尚未打开文件夹</div>
          <div className={`sub${error ? ' inline-error' : ''}`}>
            {error ?? '选择一个工程文件夹以浏览文档。'}
          </div>
          <button className="text-btn primary" onClick={onOpenProject}>
            <FolderInput size={14} strokeWidth={2} />
            打开文件夹…
          </button>
        </div>
      ) : loading ? (
        <div className="placeholder">
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="placeholder error">
          <div className="title">无法打开文件夹</div>
          <div className="sub">{error}</div>
        </div>
      ) : (
        <FileTree
          key={project.root}
          roots={roots}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          onCopyRelativePath={onCopyRelativePath}
          onAddToAiContext={onAddToAiContext}
        />
      )}

      <div className={`sidebar-visual${hideVisual ? ' hidden' : ''}`} aria-hidden="true">
        <img src={fable5Sidebar} alt="" />
      </div>

      <div className="panel-foot">
        <button className="foot-btn" title="侧栏设置" onClick={onOpenSettings}>
          <Settings size={15} strokeWidth={1.8} />
          设置
        </button>
      </div>
    </div>
  )
}
