import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { pathToFileURL } from 'url'
import { net, protocol } from 'electron'
import type { QuickLookPreview } from '../shared/types.js'
import { isWithinRoot, resolveWithinRoot } from './security.js'

const execFileAsync = promisify(execFile)

export const QUICK_LOOK_SCHEME = 'app-quicklook'

const QUICK_LOOK_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.heic',
  '.heif'
])
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

export function registerQuickLookSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: QUICK_LOOK_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export class QuickLookService {
  private readonly previews = new Map<string, string>()

  constructor(private readonly cacheRoot: string) {}

  registerProtocol(): void {
    protocol.handle(QUICK_LOOK_SCHEME, async (request) => {
      try {
        const url = new URL(request.url)
        if (url.hostname !== 'preview') return new Response('Not found', { status: 404 })

        const segments = url.pathname
          .split('/')
          .filter(Boolean)
          .map((segment) => decodeURIComponent(segment))
        const [id, ...relativeParts] = segments
        const previewRoot = id ? this.previews.get(id) : undefined
        if (!previewRoot || relativeParts.length === 0) {
          return new Response('Not found', { status: 404 })
        }

        const requested = path.resolve(previewRoot, ...relativeParts)
        if (!isWithinRoot(previewRoot, requested)) {
          return new Response('Forbidden', { status: 403 })
        }

        const realRequested = await fs.realpath(requested)
        if (!isWithinRoot(await fs.realpath(previewRoot), realRequested)) {
          return new Response('Forbidden', { status: 403 })
        }

        const response = await net.fetch(pathToFileURL(realRequested).toString())
        const headers = new Headers(response.headers)
        const ext = path.extname(realRequested).toLowerCase()
        headers.set('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream')
        if (ext === '.html') {
          headers.set(
            'Content-Security-Policy',
            `default-src 'none'; img-src ${QUICK_LOOK_SCHEME}: data:; style-src 'unsafe-inline' ${QUICK_LOOK_SCHEME}:; font-src ${QUICK_LOOK_SCHEME}: data:`
          )
        }
        return new Response(response.body, { status: response.status, headers })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
  }

  async create(projectRoot: string, filePath: string): Promise<QuickLookPreview> {
    const safePath = await resolveWithinRoot(projectRoot, filePath)
    const ext = path.extname(safePath).toLowerCase()
    if (!QUICK_LOOK_EXTENSIONS.has(ext)) throw new Error('快速预览不支持此文件类型')

    const stat = await fs.stat(safePath)
    const id = createHash('sha256')
      .update(`${safePath}\0${stat.size}\0${stat.mtimeMs}`)
      .digest('hex')
      .slice(0, 24)

    const existing = this.previews.get(id)
    if (existing) {
      return { html: await this.readPreviewHtml(id, existing) }
    }

    await fs.mkdir(this.cacheRoot, { recursive: true })
    const outputDir = path.join(this.cacheRoot, id)
    await fs.rm(outputDir, { recursive: true, force: true })
    await fs.mkdir(outputDir, { recursive: true })

    if (ext === '.heic' || ext === '.heif') {
      const converted = path.join(outputDir, 'image.png')
      try {
        await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', safePath, '--out', converted], {
          timeout: 30_000,
          maxBuffer: 1024 * 1024
        })
        await fs.writeFile(
          path.join(outputDir, 'Preview.html'),
          '<!doctype html><html><head><meta charset="utf-8"><style>html,body{height:100%;margin:0;background:#ececee}body{display:flex;align-items:center;justify-content:center;overflow:auto}img{display:block;max-width:100%;height:auto;box-shadow:0 1px 8px rgba(0,0,0,.18)}</style></head><body><img src="image.png" alt="HEIC preview"></body></html>',
          'utf-8'
        )
      } catch (error) {
        await fs.rm(outputDir, { recursive: true, force: true })
        throw new Error(
          error instanceof Error ? `HEIC 预览转换失败：${error.message}` : 'HEIC 预览转换失败'
        )
      }
      this.previews.set(id, outputDir)
      return { html: await this.readPreviewHtml(id, outputDir) }
    }

    try {
      await execFileAsync('/usr/bin/qlmanage', ['-p', '-o', outputDir, safePath], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      })
    } catch (error) {
      await fs.rm(outputDir, { recursive: true, force: true })
      throw new Error(
        error instanceof Error ? `快速预览失败：${error.message}` : '快速预览失败'
      )
    }

    const previewRoot = await this.findPreviewRoot(outputDir)
    this.previews.set(id, previewRoot)
    return { html: await this.readPreviewHtml(id, previewRoot) }
  }

  async clear(): Promise<void> {
    this.previews.clear()
    await fs.rm(this.cacheRoot, { recursive: true, force: true })
  }

  private async readPreviewHtml(id: string, previewRoot: string): Promise<string> {
    const html = await fs.readFile(path.join(previewRoot, 'Preview.html'), 'utf-8')
    const base = `<base href="${QUICK_LOOK_SCHEME}://preview/${id}/">`
    if (/<head[\s>]/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1>${base}`)
    }
    return `${base}${html}`
  }

  private async findPreviewRoot(outputDir: string): Promise<string> {
    const entries = await fs.readdir(outputDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith('.qlpreview')) continue
      const previewRoot = path.join(outputDir, entry.name)
      await fs.access(path.join(previewRoot, 'Preview.html'))
      return previewRoot
    }
    throw new Error('系统快速预览未生成可显示内容')
  }
}
