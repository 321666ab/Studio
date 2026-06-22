import { describe, expect, it } from 'vitest'
import { buildAgentCommand } from '../src/main/agentCommand.js'

describe('buildAgentCommand', () => {
  it('builds a Claude non-interactive stream-json command with bypass', () => {
    const cmd = buildAgentCommand({
      provider: 'claude',
      prompt: 'fix the bug',
      bypassPermissions: true
    })
    expect(cmd.file).toBe('claude')
    expect(cmd.args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--dangerously-skip-permissions',
      '--',
      'fix the bug'
    ])
  })

  it('omits the bypass flag for Claude when disabled', () => {
    const cmd = buildAgentCommand({
      provider: 'claude',
      prompt: 'hi',
      bypassPermissions: false
    })
    expect(cmd.args).not.toContain('--dangerously-skip-permissions')
    expect(cmd.args[cmd.args.length - 1]).toBe('hi')
  })

  it('passes the Claude task budget without changing prompt positioning', () => {
    const cmd = buildAgentCommand({
      provider: 'claude',
      prompt: '/review inspect docs/a.md',
      bypassPermissions: false,
      maxBudgetUsd: 3.5
    })
    expect(cmd.args).toContain('--max-budget-usd')
    expect(cmd.args).toContain('3.5')
    expect(cmd.args.slice(-2)).toEqual(['--', '/review inspect docs/a.md'])
  })

  it('builds a Codex exec --json command with bypass', () => {
    const cmd = buildAgentCommand({
      provider: 'codex',
      prompt: 'refactor',
      bypassPermissions: true
    })
    expect(cmd.file).toBe('codex')
    expect(cmd.args).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--dangerously-bypass-approvals-and-sandbox',
      '--',
      'refactor'
    ])
  })

  it('omits the bypass flag for Codex when disabled', () => {
    const cmd = buildAgentCommand({
      provider: 'codex',
      prompt: 'go',
      bypassPermissions: false
    })
    expect(cmd.args).toEqual(['exec', '--json', '--ephemeral', '--', 'go'])
  })

  it('passes the prompt as a single positional argument (no shell injection)', () => {
    const cmd = buildAgentCommand({
      provider: 'claude',
      prompt: '"; rm -rf / #',
      bypassPermissions: false
    })
    expect(cmd.args[cmd.args.length - 1]).toBe('"; rm -rf / #')
  })

  it('passes an explicit model to either provider', () => {
    expect(
      buildAgentCommand({
        provider: 'claude',
        prompt: 'hi',
        bypassPermissions: true,
        model: 'claude-sonnet'
      }).args
    ).toContain('claude-sonnet')
    expect(
      buildAgentCommand({
        provider: 'codex',
        prompt: 'hi',
        bypassPermissions: true,
        model: 'gpt-codex'
      }).args
    ).toContain('gpt-codex')
  })

  it('allows Codex to run in an isolated non-git copy', () => {
    const cmd = buildAgentCommand({
      provider: 'codex',
      prompt: 'inspect',
      bypassPermissions: true,
      skipGitRepoCheck: true
    })
    expect(cmd.args).toContain('--skip-git-repo-check')
  })
})
