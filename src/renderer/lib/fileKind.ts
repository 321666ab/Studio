/** Renderer-side mirror of the main process preview scheme (kept in sync by contract). */
export const PREVIEW_SCHEME = 'app-preview'

export type FileKind =
  | 'pdf'
  | 'image'
  | 'quicklook'
  | 'text'
  | 'markdown'
  | 'office'
  | 'other'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg'])
const QUICKLOOK_IMAGE_EXT = new Set(['.heic', '.heif'])
const MARKDOWN_EXT = new Set(['.md', '.markdown'])
const OFFICE_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'])
const TEXT_EXT = new Set([
  '.txt',
  '.text',
  '.log',
  '.json',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.html',
  '.xml',
  '.yml',
  '.yaml',
  '.csv',
  '.sh',
  '.py',
  '.rs',
  '.go',
  '.c',
  '.h',
  '.cpp',
  '.java',
  '.toml',
  '.ini',
  '.env'
])

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export function fileKind(name: string): FileKind {
  const ext = extOf(name)
  if (ext === '.pdf') return 'pdf'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (QUICKLOOK_IMAGE_EXT.has(ext)) return 'quicklook'
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (OFFICE_EXT.has(ext)) return 'office'
  if (TEXT_EXT.has(ext)) return 'text'
  return 'other'
}

/** Human-readable label for the file info panel. */
export function kindLabel(name: string): string {
  const ext = extOf(name).replace('.', '').toUpperCase()
  switch (fileKind(name)) {
    case 'pdf':
      return 'PDF 文档'
    case 'image':
    case 'quicklook':
      return `${ext} 图片`
    case 'markdown':
      return 'Markdown 文档'
    case 'office':
      return `${ext} 文档`
    case 'text':
      return ext ? `${ext} 文件` : '文本文件'
    default:
      return ext ? `${ext} 文件` : '文件'
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function baseName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}
