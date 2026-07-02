# Studio 项目交接给 Fable

交接日期：2026-07-02

## 1. 项目定位

Studio 是一个本地 macOS Electron 文档工作台，面向“打开一个项目目录，在同一个窗口里查看/编辑文档，并直接进入 Claude/Codex CLI 工作流”的使用场景。

当前能力重点：

- 左侧文件树：选择工程目录、浏览文件、右键复制/显示文件。
- 中间工作区：多标签、左右分屏、文本/Markdown/PDF/图片/Office/HEIC 预览。
- Markdown 编辑：支持预览编辑、源码编辑、保存和未保存提示。
- 右侧终端：Claude/Codex 终端标签、终端分屏、历史会话、快捷键聚焦。
- 主进程已有结构化 Agent Task 能力：隔离工作区运行 Claude/Codex、收集 diff、按 hash 冲突保护回写。
- 设置面板：默认 agent、模型、bypass、任务超时、通知、终端、热键、外观、布局。

注意：README 描述了右侧有 Tasks/Terminal 两种模式，但当前 `src/renderer/components/RightPanel.tsx` 只暴露交互式终端 UI。结构化 Agent Task 的 main/preload/renderer API 和样式痕迹存在，Fable 接手后应优先确认 Tasks UI 是否未提交、被回退，还是下一步待实现。

## 2. 技术栈

- Runtime：Electron 42、Node.js、TypeScript ESM。
- 构建：electron-vite、Vite、SWC、React 18。
- UI：React + CSS，图标使用 `lucide-react`。
- 终端：`node-pty` + `@xterm/xterm` + `@xterm/addon-fit`。
- Markdown：`marked` 渲染、`turndown` + GFM 插件做 HTML 到 Markdown 回写。
- 测试：Vitest + jsdom。
- 打包：electron-builder，macOS arm64，本地 unsigned/not notarized。

## 3. 本地命令

安装依赖：

```sh
npm install
```

开发运行：

```sh
npm run dev
```

类型检查：

```sh
npm run typecheck
```

测试：

```sh
npm test
```

打包并启动本地 app：

```sh
script/build_and_run.sh run
```

调试、日志和验证：

```sh
script/build_and_run.sh --debug
script/build_and_run.sh --logs
script/build_and_run.sh --telemetry
script/build_and_run.sh --verify
```

当前交接时验证结果：

- `npm run typecheck` 通过。
- `npm test` 通过，12 个测试文件、87 个测试用例全部通过。

## 4. 目录地图

- `src/main/`：Electron 主进程能力，包括窗口、IPC、文件系统、安全边界、PTY、设置、Agent Task、预览协议。
- `src/preload/index.ts`：通过 `contextBridge` 暴露 `window.studio`，是 renderer 访问主进程的唯一桥。
- `src/shared/types.ts`：共享类型和 IPC channel 合约。新增跨进程能力时先改这里。
- `src/renderer/`：React 渲染层。
- `src/renderer/components/`：主要 UI，`App.tsx` 组装三栏布局。
- `src/renderer/lib/api.ts`：renderer 侧 promise API 封装，统一 unwrap `IpcResult`。
- `test/`：主进程纯逻辑、设置、安全、diff、workspace、markdown、hotkey 等单元测试。
- `script/build_and_run.sh`：本地 macOS build/package/run/debug/verify 辅助脚本。
- `electron-builder.yml`：打包配置，`node-pty` native module 需 `asarUnpack`。

## 5. 关键架构

### 5.1 主进程入口

`src/main/index.ts` 负责：

- 创建 Electron 窗口，开启 `contextIsolation`、`sandbox`，禁用 nodeIntegration。
- 注册 `app-preview://` 和 `app-quicklook://` 两套受控预览协议。
- 初始化设置、项目状态、Agent 可用性检测、Claude Skill 能力服务、Agent Task 管理器。
- 注册 IPC：project、fs、settings、skills、agent、pty、hotkeys。
- 同步全局快捷键，并把触发事件发给 renderer。

### 5.2 文件访问安全

所有文件读写和预览都应经过 `src/main/security.ts` 的 `resolveWithinRoot()`：

- 先解析项目 root 和目标路径真实路径。
- 对 symlink 做 realpath 校验。
- 目标不存在时解析最近存在父目录再做边界检查。

这条边界很重要，新增文件/预览/导出能力时不要绕过。

### 5.3 文档工作区

主要文件：

- `src/renderer/App.tsx`：三栏布局、项目打开、面板宽度、设置弹窗、热键路由。
- `src/renderer/components/Sidebar.tsx`、`FileTree.tsx`：文件树。
- `src/renderer/components/DocumentWorkspace.tsx`：中心区域多标签和左右分屏。
- `src/renderer/components/Viewer.tsx`：文件类型分流和 Markdown 编辑。

文件类型策略：

- PDF/PNG/JPEG 走 `app-preview://`。
- Office、HEIC/HEIF 走 QuickLook；HEIC/HEIF 用 macOS `sips` 转 PNG。
- Markdown 可编辑；普通文本只读；大文本读取前 2 MiB。
- Markdown 保存限制为 `.md`/`.markdown`，最大 5 MiB。

### 5.4 右侧终端

主要文件：

- `src/renderer/components/RightPanel.tsx`
- `src/renderer/components/TerminalView.tsx`
- `src/main/pty.ts`

行为：

- 右侧目前只提供 Claude/Codex 交互式终端。
- 终端在真实项目目录内启动，不是隔离工作区。
- Claude 启动命令默认 `claude --dangerously-skip-permissions`。
- Codex 启动命令默认 `codex --dangerously-bypass-approvals-and-sandbox`。
- `createPtyEnvironment()` 会清理当前 Codex/Claude 环境变量，设置 UTF-8 locale 和 truecolor。

### 5.5 结构化 Agent Task

主要文件：

- `src/main/agentTaskManager.ts`
- `src/main/agentCommand.ts`
- `src/main/workspace.ts`
- `src/main/workspaceDiff.ts`
- `src/main/contextService.ts`
- `src/main/claudeCapability.ts`

设计意图：

1. renderer 调 `api.startAgentTask()`，preload 转发到 main。
2. `AgentTaskManager` 校验 provider/prompt/skill/context。
3. 根据项目类型准备隔离工作区：
   - Git repo 且项目在 repo top-level：创建 detached git worktree，再同步用户未提交改动。
   - 非 Git 或子目录项目：复制到临时目录。
   - 非 Git 目录超过 500 MiB 时，若用户给了 context，则只复制 context 范围。
4. 在隔离工作区中非交互执行：
   - Claude：`claude --print --output-format stream-json --verbose --no-session-persistence`
   - Codex：`codex exec --json --ephemeral`
5. 任务结束后 snapshot 工作区，计算新增/修改/删除文件和 unified diff。
6. 用户应用更改时，用 baseline hash 对比当前源码 hash；若源码期间被修改则拒绝覆盖并返回 conflict。

重要限制：

- context token budget 默认 24K。
- context 文件估算最多读取每个文件前 64 KiB。
- diff 对超过 1 MiB 的文本或过大 diff matrix 会跳过内容 diff，但仍保留 hash。
- Claude Skill 只允许 Claude provider 执行。
- Codex 在非 Git 临时工作区会加 `--skip-git-repo-check`。

### 5.6 Claude Skill 发现

`ClaudeCapabilityService` 会合并：

- 内置技能：batch、code-review、debug、loop、claude-api。
- 用户技能：`~/.claude/skills/**/SKILL.md`。
- 项目技能：`<project>/.claude/skills/**/SKILL.md`。
- Claude plugin 技能：通过 `claude plugin list --json` 和 `claude plugin details` 解析。

合并策略按 command 去重，排序优先级为 project、user、plugin、bundled。

## 6. 设置和持久化

`src/main/settings.ts` 管理版本化设置文件。设置存在 Electron macOS user-data 目录下，文件路径由 `defaultSettingsPath(app.getPath('userData'))` 生成。

默认值包括：

- `restoreLastProject: true`
- 默认 provider：Claude
- bypass permissions：true
- task timeout：10 分钟
- 终端 scrollback：5000
- 右侧/左侧宽度和外观参数
- 5 个热键槽位

设置合并后会重新 normalize，损坏或非法字段不会直接拖垮 app。

## 7. 打包和平台注意事项

- 目标平台当前是 macOS Apple Silicon / arm64。
- `electron-builder.yml` 明确 unsigned：`identity: null`。
- 产物在 `dist/`，例如 `dist/mac-arm64/Studio.app`。
- `node-pty` native binding 必须 unpack：`asarUnpack: "**/node_modules/node-pty/**"`。
- QuickLook 和 HEIC 预览依赖 macOS 系统工具：`qlmanage`、`/usr/bin/sips`。
- 未签名 build 首次打开会触发 Gatekeeper 提示，这是预期行为。

## 8. 当前工作区状态

交接时 `git status --short` 显示已有未提交图标资源改动：

- `build/AppIcon.iconset/*.png`
- `build/icon-cropped.png`
- `build/icon-source.png`
- `build/icon.icns`

这些不是本交接文件产生的改动。接手时请先确认这些图标变更是否要保留、提交或丢弃。

本交接新增文件：

- `FABLE_HANDOFF.md`

## 9. 接手优先事项

1. 核实 Tasks UI 状态  
   README、main/preload/API 和 CSS 都指向结构化 Tasks 能力，但 `RightPanel` 当前只呈现终端。先确认产品意图，再决定恢复/实现 Tasks 入口。

2. 做一次真实 app 验证  
   运行 `script/build_and_run.sh --verify`，打开项目目录，验证文件树、Markdown 保存、PDF/图片预览、QuickLook、Claude/Codex 终端启动。

3. 验证 Agent Task 端到端  
   如果要继续结构化任务能力，需要补或恢复 renderer UI，并做一轮真实 Claude/Codex 任务、diff 展示、选择性 apply、冲突保护测试。

4. 明确 bypass 默认值  
   交互终端和结构化任务默认都偏向 bypass。若要给普通用户分发，建议重新审视默认安全策略和 UI 提示。

5. 梳理 README 与实际 UI  
   当前 README 对 Tasks 的描述可能领先于代码。交接后建议同步 README，避免新接手者按不存在的入口排查问题。

6. 扩充集成测试  
   单元测试覆盖不错，但 Electron UI、预览协议、PTY、QuickLook、真实 agent CLI 仍主要靠手测。

## 10. 改动入口速查

- 新增 IPC 能力：先改 `src/shared/types.ts`，再改 `src/preload/index.ts`、`src/renderer/lib/api.ts`、`src/main/index.ts`。
- 新增文件类型预览：改 `src/renderer/lib/fileKind.ts`、`src/renderer/components/Viewer.tsx`，必要时改 `src/main/preview.ts` 或 `quickLook.ts`。
- 改 agent 命令参数：`src/main/agentCommand.ts`。
- 改隔离工作区策略：`src/main/workspace.ts`。
- 改 diff/apply 冲突策略：`src/main/workspaceDiff.ts` 和 `src/main/agentTaskManager.ts`。
- 改设置 schema：`src/shared/types.ts`、`src/main/settings.ts`、`src/renderer/components/SettingsPanel.tsx`，并补 `test/settings.test.ts`。
- 改快捷键：`src/shared/hotkeys.ts`、`src/shared/hotkeyPresets.ts`、`src/main/index.ts`、`src/renderer/App.tsx`。

## 11. 建议交接验收清单

- `npm install` 后可正常 `npm run typecheck`。
- `npm test` 全绿。
- `npm run dev` 可启动开发 app。
- `script/build_and_run.sh run` 可生成并打开 unsigned `Studio.app`。
- 打开一个项目目录后，文件树不会显示 `.git`、`node_modules`、`dist`、`out` 等忽略项。
- Markdown 可以编辑和保存，普通文本不会误写。
- PDF/图片/Office/HEIC 预览路径不会越过项目 root。
- Claude/Codex CLI 在右侧终端能启动，并在项目根目录。
- 如果恢复 Tasks UI，agent 任务 apply 不会覆盖任务期间用户手动改过的源文件。
