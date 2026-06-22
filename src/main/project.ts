import { promises as fs } from 'fs'
import path from 'path'
import type { ProjectInfo } from '../shared/types.js'

/**
 * Holds the single active project root. Path safety throughout the app is
 * anchored to whatever this returns, so it is the only mutable source of truth.
 */
class ProjectState {
  private current: ProjectInfo | null = null

  get(): ProjectInfo | null {
    return this.current
  }

  async set(root: string): Promise<ProjectInfo> {
    const realRoot = await fs.realpath(root)
    const stat = await fs.stat(realRoot)
    if (!stat.isDirectory()) {
      throw new Error('Selected path is not a directory')
    }
    this.current = { root: realRoot, name: path.basename(realRoot) }
    return this.current
  }

  /** Returns the current root or throws if no project is open. */
  requireRoot(): string {
    if (!this.current) throw new Error('No project is open')
    return this.current.root
  }
}

export const projectState = new ProjectState()
