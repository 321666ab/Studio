import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadWorkspaceSession,
  parseWorkspaceSession,
  saveWorkspaceSession,
  type WorkspaceSession
} from '../src/renderer/lib/workspaceSession.js'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear()
})

function validSession(): WorkspaceSession {
  return {
    panes: [
      {
        id: 'left',
        tabs: [
          { name: 'one.md', path: '/project/one.md' },
          { name: 'two.md', path: '/project/two.md' }
        ],
        activePath: '/project/two.md'
      },
      {
        id: 'right',
        tabs: [{ name: 'three.md', path: '/project/three.md' }],
        activePath: '/project/three.md'
      }
    ],
    focusedPane: 'right'
  }
}

describe('parseWorkspaceSession', () => {
  it('round-trips a valid session', () => {
    const session = validSession()
    expect(parseWorkspaceSession(JSON.stringify(session))).toEqual(session)
  })

  it('returns null for malformed JSON', () => {
    expect(parseWorkspaceSession('{not json')).toBeNull()
  })

  it('returns null for missing or invalid focusedPane', () => {
    expect(parseWorkspaceSession(JSON.stringify({ panes: [] }))).toBeNull()
    expect(parseWorkspaceSession(JSON.stringify({ panes: [], focusedPane: 'center' }))).toBeNull()
  })

  it('returns null when panes is not an array', () => {
    expect(parseWorkspaceSession(JSON.stringify({ panes: {}, focusedPane: 'left' }))).toBeNull()
  })

  it('returns null for duplicate pane ids', () => {
    expect(
      parseWorkspaceSession(
        JSON.stringify({
          panes: [
            { id: 'left', tabs: [], activePath: null },
            { id: 'left', tabs: [], activePath: null }
          ],
          focusedPane: 'left'
        })
      )
    ).toBeNull()
  })

  it('returns null when the right pane is first or the left pane is missing', () => {
    expect(
      parseWorkspaceSession(
        JSON.stringify({
          panes: [
            { id: 'right', tabs: [], activePath: null },
            { id: 'left', tabs: [], activePath: null }
          ],
          focusedPane: 'right'
        })
      )
    ).toBeNull()
    expect(
      parseWorkspaceSession(
        JSON.stringify({
          panes: [{ id: 'right', tabs: [], activePath: null }],
          focusedPane: 'right'
        })
      )
    ).toBeNull()
  })

  it('filters invalid tabs out of otherwise valid panes', () => {
    const parsed = parseWorkspaceSession(
      JSON.stringify({
        panes: [
          {
            id: 'left',
            tabs: [
              { name: 'good.md', path: '/project/good.md' },
              { name: 123, path: '/project/bad-name.md' },
              { name: 'bad-path.md', path: null },
              null
            ],
            activePath: '/project/good.md'
          }
        ],
        focusedPane: 'left'
      })
    )
    expect(parsed?.panes[0].tabs).toEqual([{ name: 'good.md', path: '/project/good.md' }])
  })

  it("falls back when activePath isn't among the valid tabs", () => {
    const parsed = parseWorkspaceSession(
      JSON.stringify({
        panes: [
          {
            id: 'left',
            tabs: [{ name: 'first.md', path: '/project/first.md' }],
            activePath: '/project/missing.md'
          },
          {
            id: 'right',
            tabs: [],
            activePath: '/project/missing.md'
          }
        ],
        focusedPane: 'right'
      })
    )
    expect(parsed?.panes[0].activePath).toBe('/project/first.md')
    expect(parsed?.panes[1].activePath).toBeNull()
  })

  it("falls back to left when focusedPane points at a pane that isn't present", () => {
    const parsed = parseWorkspaceSession(
      JSON.stringify({
        panes: [{ id: 'left', tabs: [], activePath: null }],
        focusedPane: 'right'
      })
    )
    expect(parsed?.focusedPane).toBe('left')
  })

  it('caps each pane tab list at 30', () => {
    const tabs = Array.from({ length: 35 }, (_, index) => ({
      name: `${index}.md`,
      path: `/project/${index}.md`
    }))
    const parsed = parseWorkspaceSession(
      JSON.stringify({
        panes: [{ id: 'left', tabs, activePath: '/project/0.md' }],
        focusedPane: 'left'
      })
    )
    expect(parsed?.panes[0].tabs).toHaveLength(30)
    expect(parsed?.panes[0].tabs.at(-1)?.path).toBe('/project/29.md')
  })
})

describe('loadWorkspaceSession / saveWorkspaceSession', () => {
  beforeEach(() => {
    store.clear()
  })

  it('round-trips through localStorage', () => {
    const session = validSession()
    saveWorkspaceSession('/project', session)
    expect(loadWorkspaceSession('/project')).toEqual(session)
    expect(loadWorkspaceSession('/other')).toBeNull()
  })
})
