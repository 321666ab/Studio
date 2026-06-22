import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import type { AgentSkill, AgentSkillSource } from '../shared/types.js'

const execFileAsync = promisify(execFile)

const BUNDLED_SKILLS: AgentSkill[] = [
  bundled('batch', 'Batch', '并行处理一组相互独立的任务。'),
  bundled('code-review', 'Code Review', '审查代码修改并报告具体问题。'),
  bundled('debug', 'Debug', '系统化调查错误、失败和异常行为。'),
  bundled('loop', 'Loop', '按目标持续迭代并验证结果。'),
  bundled('claude-api', 'Claude API', '构建或审查 Claude API 集成。')
]

interface PluginListItem {
  name?: string
  id?: string
  enabled?: boolean
  status?: string
}

export class ClaudeCapabilityService {
  private cache: AgentSkill[] | null = null

  constructor(
    private readonly getProjectRoot: () => string | null,
    private readonly getExecutable: () => Promise<string>
  ) {}

  async list(force = false): Promise<AgentSkill[]> {
    if (this.cache && !force) return this.cache
    const [user, project, plugins] = await Promise.all([
      scanSkillDirectory(path.join(os.homedir(), '.claude', 'skills'), 'user'),
      this.getProjectRoot()
        ? scanSkillDirectory(path.join(this.getProjectRoot()!, '.claude', 'skills'), 'project')
        : Promise.resolve([]),
      this.scanPlugins()
    ])

    this.cache = mergeAgentSkills([...BUNDLED_SKILLS, ...user, ...project, ...plugins])
    return this.cache
  }

  refresh(): Promise<AgentSkill[]> {
    this.cache = null
    return this.list(true)
  }

  async details(skillId: string): Promise<AgentSkill | null> {
    return (await this.list()).find((skill) => skill.id === skillId) ?? null
  }

  invalidate(): void {
    this.cache = null
  }

  private async scanPlugins(): Promise<AgentSkill[]> {
    try {
      const executable = await this.getExecutable()
      const { stdout } = await execFileAsync(executable, ['plugin', 'list', '--json'], {
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024
      })
      const parsed = JSON.parse(stdout) as unknown
      if (!Array.isArray(parsed)) return []
      const groups = await Promise.all(
        parsed.map((item) => this.pluginSkills(executable, item as PluginListItem))
      )
      return groups.flat()
    } catch {
      return []
    }
  }

  private async pluginSkills(executable: string, plugin: PluginListItem): Promise<AgentSkill[]> {
    const pluginName = plugin.name ?? plugin.id
    if (!pluginName) return []
    const available = plugin.enabled !== false && plugin.status !== 'disabled'
    try {
      const { stdout } = await execFileAsync(executable, ['plugin', 'details', pluginName], {
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024
      })
      return parsePluginDetails(pluginName, stdout, available)
    } catch {
      return []
    }
  }
}

export function mergeAgentSkills(skills: AgentSkill[]): AgentSkill[] {
  const byCommand = new Map<string, AgentSkill>()
  for (const skill of skills) byCommand.set(skill.command, skill)
  return [...byCommand.values()].sort(compareSkills)
}

export async function scanSkillDirectory(
  root: string,
  source: Extract<AgentSkillSource, 'user' | 'project'>
): Promise<AgentSkill[]> {
  const files: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && entry.name === 'SKILL.md') files.push(full)
    }
  }
  await walk(root, 0)

  const results = await Promise.all(
    files.map(async (file) => {
      try {
        return parseSkillMarkdown(await fs.readFile(file, 'utf-8'), file, source)
      } catch {
        return null
      }
    })
  )
  return results.filter((skill): skill is AgentSkill => skill !== null)
}

export function parseSkillMarkdown(
  markdown: string,
  filePath: string,
  source: Extract<AgentSkillSource, 'user' | 'project'>
): AgentSkill | null {
  const frontmatter = parseFrontmatter(markdown)
  const fallbackName = path.basename(path.dirname(filePath))
  const commandName = cleanCommand(frontmatter.name || fallbackName)
  if (!commandName) return null
  const description =
    frontmatter.description || firstContentParagraph(markdown) || `${commandName} Skill`
  return {
    id: `${source}:${commandName}`,
    command: `/${commandName}`,
    name: frontmatter.name || humanize(commandName),
    description,
    source,
    path: filePath,
    argumentHint: frontmatter['argument-hint'],
    allowedTools: splitList(frontmatter['allowed-tools']),
    estimatedTokens: Math.max(1, Math.ceil(Buffer.byteLength(markdown, 'utf-8') / 4)),
    available: true
  }
}

export function parsePluginDetails(
  pluginName: string,
  output: string,
  available = true
): AgentSkill[] {
  const commandNamespace = pluginName.split('@')[0]
  const tokenMatch = output.match(/(?:projected|estimated)[^\d]*(\d[\d,]*)\s*tokens?/i)
  const estimatedTokens = tokenMatch ? Number(tokenMatch[1].replaceAll(',', '')) : undefined
  const commands = new Set<string>()
  for (const match of output.matchAll(/\/([a-zA-Z0-9][a-zA-Z0-9_-]*)/g)) {
    commands.add(match[1])
  }
  return [...commands].map((name) => ({
    id: `plugin:${pluginName}:${name}`,
    command: `/${commandNamespace}:${name}`,
    name: humanize(name),
    description: `${pluginName} 插件提供的 ${name} Skill`,
    source: 'plugin',
    pluginName,
    estimatedTokens,
    available
  }))
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && value) result[key] = value
  }
  return result
}

function firstContentParagraph(markdown: string): string {
  const withoutFrontmatter = markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---/, '')
  return (
    withoutFrontmatter
      .split(/\r?\n\r?\n/)
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith('#') && !part.startsWith('```')) ?? ''
  ).slice(0, 300)
}

function splitList(value?: string): string[] | undefined {
  if (!value) return undefined
  const values = value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  return values.length ? values : undefined
}

function cleanCommand(value: string): string {
  return value
    .trim()
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function humanize(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function bundled(name: string, title: string, description: string): AgentSkill {
  return {
    id: `bundled:${name}`,
    command: `/${name}`,
    name: title,
    description,
    source: 'bundled',
    available: true
  }
}

function compareSkills(a: AgentSkill, b: AgentSkill): number {
  const order: Record<AgentSkillSource, number> = {
    project: 0,
    user: 1,
    plugin: 2,
    bundled: 3
  }
  return order[a.source] - order[b.source] || a.name.localeCompare(b.name)
}
