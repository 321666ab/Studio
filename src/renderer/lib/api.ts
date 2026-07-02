import type {
  AgentAvailability,
  AgentContextEstimate,
  AgentSkill,
  AgentTask,
  AgentTaskEvent,
  AgentTaskRequest,
  ApplyChangesRequest,
  ApplyChangesResult,
  DirEntry,
  FileInfo,
  HotkeyTriggerEvent,
  IpcResult,
  PathContextMenuResult,
  ProjectInfo,
  QuickLookPreview,
  ReadFileResult,
  ResolvedColorScheme,
  Settings,
  SettingsPatch,
  WriteFileResult
} from '../../shared/types'

/**
 * Thin promise-based wrapper over window.studio that unwraps IpcResult and
 * throws on failure, so callers can use plain try/catch.
 */
function unwrap<T>(res: IpcResult<T>): T {
  if (res.ok) return res.value
  throw new Error(res.error)
}

export const api = {
  async selectProject(): Promise<ProjectInfo | null> {
    return unwrap(await window.studio.selectProject())
  },
  async getCurrentProject(): Promise<ProjectInfo | null> {
    return unwrap(await window.studio.getCurrentProject())
  },
  async readDir(dirPath: string): Promise<DirEntry[]> {
    return unwrap(await window.studio.readDir(dirPath))
  },
  async getFileInfo(filePath: string): Promise<FileInfo> {
    return unwrap(await window.studio.getFileInfo(filePath))
  },
  async readFile(filePath: string): Promise<ReadFileResult> {
    return unwrap(await window.studio.readFile(filePath))
  },
  async writeMarkdown(filePath: string, content: string): Promise<WriteFileResult> {
    return unwrap(await window.studio.writeMarkdown(filePath, content))
  },
  async openPath(targetPath: string): Promise<void> {
    return unwrap(await window.studio.openPath(targetPath))
  },
  async quickLook(filePath: string): Promise<QuickLookPreview> {
    return unwrap(await window.studio.quickLook(filePath))
  },
  async showPathContextMenu(
    targetPath: string
  ): Promise<PathContextMenuResult | null> {
    return unwrap(await window.studio.showPathContextMenu(targetPath))
  },
  async estimateContext(paths: string[]): Promise<AgentContextEstimate> {
    return unwrap(await window.studio.estimateContext(paths))
  },
  async openExternalUrl(url: string): Promise<void> {
    return unwrap(await window.studio.openExternalUrl(url))
  },
  // --- Settings ----------------------------------------------------------
  async getSettings(): Promise<Settings> {
    return unwrap(await window.studio.settings.get())
  },
  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    return unwrap(await window.studio.settings.update(patch))
  },
  onOpenSettings(listener: () => void): () => void {
    return window.studio.settings.onOpen(listener)
  },
  async getSystemColorScheme(): Promise<ResolvedColorScheme> {
    return unwrap(await window.studio.settings.getSystemColorScheme())
  },
  onSystemColorSchemeChange(listener: (scheme: ResolvedColorScheme) => void): () => void {
    return window.studio.settings.onSystemColorSchemeChange(listener)
  },
  setHotkeysSuspended(suspended: boolean): void {
    window.studio.hotkeys.setSuspended(suspended)
  },
  onHotkeyTrigger(listener: (event: HotkeyTriggerEvent) => void): () => void {
    return window.studio.hotkeys.onTrigger(listener)
  },
  // --- Skills -------------------------------------------------------------
  async listSkills(): Promise<AgentSkill[]> {
    return unwrap(await window.studio.skills.list())
  },
  async refreshSkills(): Promise<AgentSkill[]> {
    return unwrap(await window.studio.skills.refresh())
  },
  async getSkillDetails(skillId: string): Promise<AgentSkill | null> {
    return unwrap(await window.studio.skills.details(skillId))
  },
  // --- Agents ------------------------------------------------------------
  async agentAvailability(): Promise<AgentAvailability[]> {
    return unwrap(await window.studio.agent.availability())
  },
  async startAgentTask(request: AgentTaskRequest): Promise<AgentTask> {
    return unwrap(await window.studio.agent.start(request))
  },
  async cancelAgentTask(taskId: string): Promise<void> {
    return unwrap(await window.studio.agent.cancel(taskId))
  },
  async getAgentTask(taskId: string): Promise<AgentTask | null> {
    return unwrap(await window.studio.agent.get(taskId))
  },
  async listAgentTasks(): Promise<AgentTask[]> {
    return unwrap(await window.studio.agent.list())
  },
  async applyAgentChanges(request: ApplyChangesRequest): Promise<ApplyChangesResult> {
    return unwrap(await window.studio.agent.apply(request))
  },
  async discardAgentTask(taskId: string): Promise<void> {
    return unwrap(await window.studio.agent.discard(taskId))
  },
  onAgentEvent(listener: (event: AgentTaskEvent) => void): () => void {
    return window.studio.agent.onEvent(listener)
  }
}
