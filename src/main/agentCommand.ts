import type { AgentProvider } from '../shared/types.js'

export interface AgentCommand {
  file: string
  args: string[]
}

export interface CommandOptions {
  provider: AgentProvider
  prompt: string
  /** When true, pass the provider's permission/approval bypass flags. */
  bypassPermissions: boolean
  /** Optional provider-specific model identifier. */
  model?: string
  /** Codex otherwise refuses to run in a copied non-Git workspace. */
  skipGitRepoCheck?: boolean
  /** Maximum Claude API spend for this task; omitted/zero means provider default. */
  maxBudgetUsd?: number
}

/**
 * Build the non-interactive command line for an agent run. Claude uses
 * `--print` with stream-json output; Codex uses `exec --json`. Both take the
 * prompt as a positional argument so it is passed verbatim (no shell quoting).
 *
 * Pure and side-effect free so it can be unit-tested without spawning.
 */
export function buildAgentCommand(options: CommandOptions): AgentCommand {
  const { provider, prompt, bypassPermissions, model } = options
  if (provider === 'claude') {
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence'
    ]
    if (model) args.push('--model', model)
    if (options.maxBudgetUsd && options.maxBudgetUsd > 0) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd))
    }
    if (bypassPermissions) args.push('--dangerously-skip-permissions')
    args.push('--', prompt)
    return { file: 'claude', args }
  }
  // codex
  const args = ['exec', '--json', '--ephemeral']
  if (options.skipGitRepoCheck) args.push('--skip-git-repo-check')
  if (model) args.push('--model', model)
  if (bypassPermissions) args.push('--dangerously-bypass-approvals-and-sandbox')
  args.push('--', prompt)
  return { file: 'codex', args }
}
