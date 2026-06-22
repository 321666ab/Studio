import { protocol, net } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { resolveWithinRoot } from './security.js'

export const PREVIEW_SCHEME = 'app-preview'

/** Extensions the preview protocol is allowed to serve. */
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg'])

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
}

/**
 * Must be called before app `ready`. Registers the privileged scheme so it can
 * stream binary content and be treated as a secure context.
 */
export function registerPreviewSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * Register the protocol handler. Every request is realpath-validated against the
 * current project root and restricted to the allowed image/PDF extensions.
 */
export function registerPreviewProtocol(getRoot: () => string | null): void {
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    try {
      const root = getRoot()
      if (!root) return new Response('No project open', { status: 403 })

      const url = new URL(request.url)
      const requested = url.searchParams.get('path')
      if (!requested || url.hostname !== 'file' || !path.isAbsolute(requested)) {
        return new Response('Invalid preview path', { status: 400 })
      }
      const ext = path.extname(requested).toLowerCase()
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return new Response('Unsupported file type', { status: 403 })
      }

      const safePath = await resolveWithinRoot(root, requested)
      const safeExt = path.extname(safePath).toLowerCase()
      if (!ALLOWED_EXTENSIONS.has(safeExt)) {
        return new Response('Unsupported file type', { status: 403 })
      }

      const response = await net.fetch(pathToFileURL(safePath).toString())
      const headers = new Headers(response.headers)
      headers.set('Content-Type', MIME_TYPES[safeExt] ?? 'application/octet-stream')
      return new Response(response.body, { status: 200, headers })
    } catch {
      return new Response('Forbidden', { status: 403 })
    }
  })
}
