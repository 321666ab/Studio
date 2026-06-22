export interface AgentOutputLine {
  id: string
  tone: 'normal' | 'muted' | 'error'
  text: string
}

function textFromContent(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : []
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.text === 'string' && record.text.trim()) return [record.text.trim()]
    if (typeof record.content === 'string' && record.content.trim()) return [record.content.trim()]
    return []
  })
}

function extract(record: Record<string, unknown>): string[] {
  const direct = ['result', 'text', 'message', 'content', 'output_text']
  for (const key of direct) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return [value.trim()]
    const content = textFromContent(value)
    if (content.length) return content
    if (value && typeof value === 'object') {
      const nested = extract(value as Record<string, unknown>)
      if (nested.length) return nested
    }
  }
  const item = record.item
  if (item && typeof item === 'object') {
    const nested = extract(item as Record<string, unknown>)
    if (nested.length) return nested
  }
  return []
}

export function parseAgentOutput(
  chunk: string,
  startIndex: number,
  tone: AgentOutputLine['tone'] = 'normal'
): AgentOutputLine[] {
  const lines = chunk.split(/\r?\n/).filter((line) => line.trim())
  return lines.flatMap((line, index) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const messages = extract(parsed)
      if (!messages.length) return []
      return messages.map((text, messageIndex) => ({
        id: `${startIndex + index}-${messageIndex}`,
        tone,
        text
      }))
    } catch {
      return [
        {
          id: `${startIndex + index}-raw`,
          tone,
          text: line.trim()
        }
      ]
    }
  })
}
