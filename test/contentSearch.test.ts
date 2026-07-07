import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  MAX_SEARCH_FILE_BYTES,
  MAX_TOTAL_MATCHES,
  findLineMatches,
  searchProjectContent
} from '../src/main/contentSearch.js'

let root: string

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-content-search-'))
  root = path.join(base, 'project')

  await fs.mkdir(path.join(root, 'docs', 'nested'), { recursive: true })
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await fs.mkdir(path.join(root, '.git'), { recursive: true })
  await fs.mkdir(path.join(root, '.dotdir'), { recursive: true })
  await fs.mkdir(path.join(root, 'zz-cap'), { recursive: true })

  await fs.writeFile(path.join(root, 'alpha.md'), 'orchid root first\nplain\nORCHID root third')
  await fs.writeFile(path.join(root, 'docs', 'nested', 'beta.md'), 'plain\norchid nested')
  await fs.writeFile(path.join(root, 'zeta.md'), 'plain\norchid zeta')

  await fs.writeFile(path.join(root, '.hidden'), 'hiddenonly')
  await fs.writeFile(path.join(root, '.dotdir', 'hidden.md'), 'hiddenonly')
  await fs.writeFile(path.join(root, '.git', 'config'), 'hiddenonly')
  await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'hiddenonly')

  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3, 98, 105, 110]))
  await fs.writeFile(
    path.join(root, 'too-large.txt'),
    `oversizetarget${'x'.repeat(Math.ceil(MAX_SEARCH_FILE_BYTES) + 100_000)}`
  )
  await fs.writeFile(path.join(root, 'chinese.md'), '这里有中文短语可以搜索')

  await fs.writeFile(
    path.join(root, 'zz-cap', '000-single-overflow.txt'),
    Array.from({ length: 400 }, (_, index) => `overflowcap single ${index}`).join('\n')
  )
  for (let i = 1; i <= 80; i += 1) {
    await fs.writeFile(
      path.join(root, 'zz-cap', `${String(i).padStart(3, '0')}.txt`),
      Array.from({ length: 10 }, (_, index) => `overflowcap ${i}-${index}`).join('\n')
    )
  }
})

afterAll(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true })
})

describe('findLineMatches', () => {
  it('matches case-insensitively with 1-based line numbers and one hit per line', () => {
    const matches = findLineMatches('Alpha beta beta\nplain\nBETA\nprebetabeta', 'beta')
    expect(matches.map((match) => match.line)).toEqual([1, 3, 4])
    expect(matches[0]).toMatchObject({ lineText: 'Alpha beta beta', matchStart: 6, matchEnd: 10 })
    expect(matches[2]).toMatchObject({ lineText: 'prebetabeta', matchStart: 3, matchEnd: 7 })
  })

  it('respects the limit parameter', () => {
    const matches = findLineMatches('hit\nhit\nhit', 'hit', 2)
    expect(matches).toHaveLength(2)
    expect(matches.map((match) => match.line)).toEqual([1, 2])
  })

  it('splits CRLF, CR, and LF lines', () => {
    const matches = findLineMatches('hit crlf\r\nplain\nhit lf\rhit cr', 'hit')
    expect(matches.map((match) => match.line)).toEqual([1, 3, 4])
  })

  it('keeps highlight offsets valid when clipping long lines near the end', () => {
    const query = 'needle'
    const line = `${'a'.repeat(260)}NEEDLE${'z'.repeat(20)}`
    const [match] = findLineMatches(line, query)
    expect(match.lineText).toHaveLength(200)
    expect(match.lineText.slice(match.matchStart, match.matchEnd).toLowerCase()).toBe(query)
  })

  it('returns no matches for an empty query', () => {
    expect(findLineMatches('anything', '')).toEqual([])
  })
})

describe('searchProjectContent', () => {
  it('finds nested matches with relative paths sorted by relativePath then line', async () => {
    const result = await searchProjectContent(root, 'orchid')
    expect(result.matches.map((match) => [match.relativePath, match.line])).toEqual([
      ['alpha.md', 1],
      ['alpha.md', 3],
      [path.join('docs', 'nested', 'beta.md'), 2],
      ['zeta.md', 2]
    ])
  })

  it('skips files in ignored directories and dotfiles', async () => {
    const result = await searchProjectContent(root, 'hiddenonly')
    expect(result.matches).toEqual([])
  })

  it('skips binary files containing NUL bytes', async () => {
    const result = await searchProjectContent(root, 'bin')
    expect(result.matches).toEqual([])
  })

  it('skips files larger than MAX_SEARCH_FILE_BYTES', async () => {
    const result = await searchProjectContent(root, 'oversizetarget')
    expect(result.matches).toEqual([])
  })

  it('matches UTF-8 Chinese queries', async () => {
    const result = await searchProjectContent(root, '中文短语')
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({
      relativePath: 'chinese.md',
      line: 1
    })
  })

  it('returns an empty result without scanning files for a whitespace-only query', async () => {
    await expect(searchProjectContent(root, '   \n\t  ')).resolves.toEqual({
      matches: [],
      filesScanned: 0,
      truncated: false
    })
  })

  it('sets truncated when the global match cap is exceeded', async () => {
    const result = await searchProjectContent(root, 'overflowcap')
    expect(result.truncated).toBe(true)
    expect(result.matches).toHaveLength(MAX_TOTAL_MATCHES)
  })
})
