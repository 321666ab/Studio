import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  IGNORED_NAMES,
  isIgnoredEntry,
  isWithinRoot,
  resolveWithinRoot
} from '../src/main/security.js'
import { decodeText, writeMarkdown } from '../src/main/fileService.js'
import { createPtyEnvironment, createPtyLaunch } from '../src/main/pty.js'

let root: string
let outside: string

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-test-'))
  root = await fs.realpath(await fs.mkdir(path.join(base, 'project'), { recursive: true }).then(() => path.join(base, 'project')))
  outside = await fs.realpath(await fs.mkdir(path.join(base, 'outside'), { recursive: true }).then(() => path.join(base, 'outside')))

  await fs.writeFile(path.join(root, 'inside.txt'), 'hello')
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret')
  await fs.mkdir(path.join(root, 'sub'), { recursive: true })
})

afterAll(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true })
})

describe('isWithinRoot', () => {
  it('accepts the root itself and descendants', () => {
    expect(isWithinRoot(root, root)).toBe(true)
    expect(isWithinRoot(root, path.join(root, 'a/b'))).toBe(true)
  })

  it('rejects ancestors and siblings', () => {
    expect(isWithinRoot(root, path.dirname(root))).toBe(false)
    expect(isWithinRoot(root, outside)).toBe(false)
  })

  it('rejects path-prefix lookalikes', () => {
    expect(isWithinRoot('/a/project', '/a/project-evil/file')).toBe(false)
  })
})

describe('isIgnoredEntry', () => {
  it('filters dotfiles', () => {
    expect(isIgnoredEntry('.env')).toBe(true)
    expect(isIgnoredEntry('.git')).toBe(true)
  })

  it('filters known cache/vcs/build dirs', () => {
    for (const name of IGNORED_NAMES) {
      expect(isIgnoredEntry(name)).toBe(true)
    }
    expect(isIgnoredEntry('node_modules')).toBe(true)
  })

  it('keeps ordinary files', () => {
    expect(isIgnoredEntry('index.ts')).toBe(false)
    expect(isIgnoredEntry('README.md')).toBe(false)
  })
})

describe('resolveWithinRoot', () => {
  it('resolves a real file inside the root', async () => {
    const resolved = await resolveWithinRoot(root, path.join(root, 'inside.txt'))
    expect(resolved).toBe(path.join(root, 'inside.txt'))
  })

  it('accepts relative paths against the root', async () => {
    const resolved = await resolveWithinRoot(root, 'inside.txt')
    expect(resolved).toBe(path.join(root, 'inside.txt'))
  })

  it('rejects traversal outside the root', async () => {
    await expect(resolveWithinRoot(root, path.join(root, '..', 'outside', 'secret.txt'))).rejects.toThrow(
      /escapes project root/
    )
  })

  it('rejects a symlink that points outside the root', async () => {
    const link = path.join(root, 'escape-link')
    await fs.symlink(path.join(outside, 'secret.txt'), link)
    await expect(resolveWithinRoot(root, link)).rejects.toThrow(/escapes project root/)
  })

  it('accepts a symlink that stays inside the root', async () => {
    const target = path.join(root, 'inside.txt')
    const link = path.join(root, 'inside-link')
    await fs.symlink(target, link)
    const resolved = await resolveWithinRoot(root, link)
    expect(resolved).toBe(target)
  })

  it('validates non-existent paths against their nearest real ancestor', async () => {
    await expect(
      resolveWithinRoot(root, path.join(root, 'sub', 'does-not-exist.txt'))
    ).resolves.toBe(path.join(root, 'sub', 'does-not-exist.txt'))
    await expect(
      resolveWithinRoot(root, path.join(root, '..', 'outside', 'nope.txt'))
    ).rejects.toThrow(/escapes project root/)
  })
})

describe('decodeText', () => {
  it('decodes valid UTF-8', () => {
    const buf = Buffer.from('héllo 你好', 'utf-8')
    const { content, encoding } = decodeText(buf)
    expect(encoding).toBe('utf-8')
    expect(content).toBe('héllo 你好')
  })

  it('falls back to GB18030 for invalid UTF-8', () => {
    // 0xC4 0xE3 is "你" in GB18030 but invalid as standalone UTF-8.
    const buf = Buffer.from([0xc4, 0xe3])
    const { content, encoding } = decodeText(buf)
    expect(encoding).toBe('gb18030')
    expect(content).toBe('你')
  })
})

describe('writeMarkdown', () => {
  it('writes UTF-8 Markdown inside the project root', async () => {
    const file = path.join(root, 'notes.md')
    await fs.writeFile(file, '# old')
    await expect(writeMarkdown(root, file, '# 新内容\n')).resolves.toMatchObject({
      size: Buffer.byteLength('# 新内容\n')
    })
    await expect(fs.readFile(file, 'utf-8')).resolves.toBe('# 新内容\n')
  })

  it('rejects non-Markdown files', async () => {
    await expect(writeMarkdown(root, path.join(root, 'inside.txt'), 'changed')).rejects.toThrow(
      /Markdown/
    )
  })

  it('rejects Markdown paths outside the project root', async () => {
    const file = path.join(outside, 'outside.md')
    await fs.writeFile(file, '# outside')
    await expect(writeMarkdown(root, file, '# changed')).rejects.toThrow(/escapes project root/)
  })
})

describe('createPtyEnvironment', () => {
  it('forces a UTF-8 locale for Finder-launched shells', () => {
    const env = createPtyEnvironment({
      HOME: '/tmp/home',
      LANG: 'C',
      LC_ALL: 'C',
      NO_COLOR: '1',
      CLAUDECODE: '1',
      CODEX_THREAD_ID: 'thread'
    })
    expect(env).toMatchObject({
      HOME: '/tmp/home',
      LANG: 'en_US.UTF-8',
      LC_CTYPE: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Studio',
      FORCE_COLOR: '3',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1'
    })
    expect(env).not.toHaveProperty('NO_COLOR')
    expect(env).not.toHaveProperty('CLAUDECODE')
    expect(env).not.toHaveProperty('CODEX_THREAD_ID')
  })
})

describe('createPtyLaunch', () => {
  it('starts Claude directly in bypass mode through a login shell', () => {
    expect(createPtyLaunch('claude', '/bin/zsh')).toEqual({
      file: '/bin/zsh',
      args: [
        '-l',
        '-c',
        'unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION CODEX_THREAD_ID CODEX_INTERNAL_ORIGINATOR_OVERRIDE; command -v claude >/dev/null || { echo "Claude CLI 未安装或不在登录 shell 的 PATH 中"; exit 127; }; exec claude --dangerously-skip-permissions'
      ]
    })
  })

  it('starts Codex directly with approvals and sandbox bypassed', () => {
    expect(createPtyLaunch('codex', '/bin/zsh')).toEqual({
      file: '/bin/zsh',
      args: [
        '-l',
        '-c',
        'unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION CODEX_THREAD_ID CODEX_INTERNAL_ORIGINATOR_OVERRIDE; command -v codex >/dev/null || { echo "Codex CLI 未安装或不在登录 shell 的 PATH 中"; exit 127; }; exec codex --dangerously-bypass-approvals-and-sandbox'
      ]
    })
  })
})
