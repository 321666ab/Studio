import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  mergeAgentSkills,
  parsePluginDetails,
  parseSkillMarkdown,
  scanSkillDirectory
} from '../src/main/claudeCapability.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('Claude skills', () => {
  it('parses frontmatter and command metadata', () => {
    const skill = parseSkillMarkdown(
      `---
name: document-review
description: Review project documents.
argument-hint: "[scope]"
allowed-tools: Read, Grep
---

# Document review
`,
      '/tmp/document-review/SKILL.md',
      'project'
    )
    expect(skill).toMatchObject({
      id: 'project:document-review',
      command: '/document-review',
      name: 'document-review',
      description: 'Review project documents.',
      argumentHint: '[scope]',
      allowedTools: ['Read', 'Grep'],
      source: 'project'
    })
  })

  it('falls back to the directory name when frontmatter is missing', () => {
    const skill = parseSkillMarkdown(
      '# Summarize\n\nSummarize selected documents.',
      '/tmp/summarize/SKILL.md',
      'user'
    )
    expect(skill?.command).toBe('/summarize')
    expect(skill?.description).toBe('Summarize selected documents.')
  })

  it('scans nested skill folders and ignores unreadable or unrelated files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-skills-'))
    tempDirs.push(root)
    await fs.mkdir(path.join(root, 'group', 'review'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'group', 'review', 'SKILL.md'),
      '---\nname: review\n---\n\nReview docs.'
    )
    await fs.writeFile(path.join(root, 'README.md'), 'ignore')
    const skills = await scanSkillDirectory(root, 'user')
    expect(skills.map((skill) => skill.command)).toEqual(['/review'])
  })

  it('keeps plugin skills namespaced and captures token estimates', () => {
    const skills = parsePluginDetails(
      'knowledge-work',
      'Skills:\n  /summarize\n  /cross-check\nProjected cost: 1,250 tokens'
    )
    expect(skills.map((skill) => skill.command).sort()).toEqual([
      '/knowledge-work:cross-check',
      '/knowledge-work:summarize'
    ])
    expect(skills[0].estimatedTokens).toBe(1250)
  })

  it('removes marketplace suffixes from plugin skill commands', () => {
    const [skill] = parsePluginDetails(
      'knowledge-work@claude-plugins-official',
      'Skills: /summarize'
    )
    expect(skill.command).toBe('/knowledge-work:summarize')
  })

  it('lets project skills override user skills with the same command', () => {
    const user = parseSkillMarkdown('User instructions', '/tmp/review/SKILL.md', 'user')!
    const project = parseSkillMarkdown(
      'Project instructions',
      '/tmp/project/review/SKILL.md',
      'project'
    )!
    const merged = mergeAgentSkills([user, project])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('project')
  })
})
