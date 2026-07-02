import { FolderInput, PanelLeftClose, Settings } from 'lucide-react'
import type { DirEntry, ProjectInfo } from '../../shared/types'
import { FileTree } from './FileTree'

interface SidebarProps {
  project: ProjectInfo | null
  roots: DirEntry[]
  loading: boolean
  error: string | null
  selectedPath: string | null
  onOpenProject: () => void
  onSelectFile: (entry: DirEntry) => void
  onCopyRelativePath: (relativePath: string) => void
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
  onCollapse,
  onOpenSettings
}: SidebarProps): JSX.Element {
  return (
    <>
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
        />
      )}

      <div className="panel-foot">
        <button className="foot-btn" title="侧栏设置" onClick={onOpenSettings}>
          <Settings size={15} strokeWidth={1.8} />
          设置
        </button>
      </div>
    </>
  )
}
