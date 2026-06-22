import { describe, expect, it } from 'vitest'
import { parseAgentOutput } from '../src/renderer/lib/agentOutput'

describe('parseAgentOutput', () => {
  it('extracts nested assistant text from JSON lines', () => {
    const result = parseAgentOutput(
      '{"message":{"content":[{"type":"text","text":"任务完成"}]}}\n',
      0
    )
    expect(result.map((line) => line.text)).toEqual(['任务完成'])
  })

  it('keeps plain stderr readable', () => {
    const result = parseAgentOutput('command failed\n', 4, 'error')
    expect(result).toEqual([{ id: '4-raw', tone: 'error', text: 'command failed' }])
  })
})
