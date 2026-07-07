import { clipboard } from 'electron'

/**
 * Copy actual files (not just their paths) to the macOS pasteboard so Finder
 * can paste them with ⌘V. Electron has no first-class API for this; writing an
 * XML plist of paths under NSFilenamesPboardType is the established mechanism
 * and, unlike shelling out to osascript, works from a background process.
 */

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Pure: build the NSFilenamesPboardType plist payload for absolute paths. */
export function filenamesPboardPlist(paths: string[]): string {
  const items = paths.map((item) => `<string>${escapeXml(item)}</string>`).join('')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
    '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
    `<plist version="1.0"><array>${items}</array></plist>`
  )
}

export function copyFilesToClipboard(paths: string[]): void {
  if (process.platform !== 'darwin') {
    clipboard.writeText(paths.join('\n'))
    return
  }
  clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(filenamesPboardPlist(paths), 'utf-8'))
}
