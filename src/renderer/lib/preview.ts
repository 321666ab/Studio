import { PREVIEW_SCHEME } from './fileKind'

/**
 * Build a secure app-preview:// URL for an absolute file path. The main process
 * realpath-validates the request against the open project root, so we only need
 * to encode the path safely. The first path segment becomes the URL hostname,
 * which must be lowercased and percent-encoded per segment.
 */
export function previewUrl(absPath: string): string {
  return `${PREVIEW_SCHEME}://file?path=${encodeURIComponent(absPath)}`
}
