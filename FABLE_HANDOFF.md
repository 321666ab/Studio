# Studio 项目交接给 Fable

交接日期：2026-07-04

## 1. 项目定位

Studio 是一个本地 macOS Electron 文档工作台，面向“打开一个项目目录，在同一个窗口里查看/编辑文档，并直接进入 Claude/Codex CLI 工作流”的使用场景。

当前能力重点：

- 左侧文件树：选择工程目录、浏览文件、右键复制/显示文件。
- 中间工作区：多标签、左右分屏、文本/Markdown/PDF/图片/Office/HEIC 预览。
- Markdown 编辑：支持预览编辑、源码编辑、保存和未保存提示。
- 右侧 AI 工作区：Tasks/Terminal 双模式。Tasks 用隔离工作区运行 Claude/Codex、收集 diff、按 hash 冲突保护回写；Terminal 保留交互式 Claude/Codex 终端标签、终端分屏、历史会话、快捷键聚焦。
- 设置面板：默认 agent、模型、bypass、任务超时、通知、终端、热键、外观、布局。

注意：当前代码中 `src/renderer/components/RightPanel.tsx` 已接入 Tasks/Terminal 双模式，`src/renderer/components/TaskWorkspace.tsx` 是结构化任务 UI。若右侧只显示终端，请先检查 设置 → AI → 任务工作台 的开关，以及 `settings.ai.tasksEnabled` 默认值。

## 2. 给 Fable 5 的 UI 重调交接文本

请基于现有 React/Electron 代码重调 Studio.app 的 UI。目标不是重做产品，而是在保持当前功能完整的前提下，让界面更像成熟的 macOS 文档工作台：信息密度高、层级清楚、可长期使用、不像营销页或 demo。

核心产品结构：

1. 顶部是 macOS 窗口拖拽标题栏，仅放折叠侧栏的必要图标。
2. 左侧是项目文件栏，用于打开项目、浏览文件树、右键复制相对路径或加入 AI 上下文。
3. 中间是文档工作区，支持多标签、左右分屏、Markdown 预览编辑/源码编辑、PDF/图片/Office/QuickLook 预览。
4. 右侧是 AI 工作区，包含 Tasks 和 Terminal 两种模式。Tasks 是结构化任务流，包含 provider、prompt、Skill、上下文、运行输出、diff 审阅、选择性应用；Terminal 是 Claude/Codex 交互式终端标签和终端分屏。
5. 设置弹窗集中管理通用、AI、通知、终端、热键、会话、外观。

UI 重调方向：

- 保留三栏工具型应用的信息架构，不要改成 landing page、卡片堆叠首页或大 hero。
- 降低玻璃/半透明层叠带来的噪声，强化内容区、侧栏、右侧工作区之间的边界和状态。
- 统一控件体系：icon button、segmented control、select、toggle、slider、diff card、tab、settings row 要有一致的尺寸、圆角、hover/focus/active 状态。
- 优先优化右侧 AI 工作区，因为它是 Studio 的差异化功能。Tasks 模式需要更像任务控制台：输入区、上下文区、运行状态、输出、文件修改这几块要更清楚。
- 中心文档区要保持阅读/编辑优先，Markdown 工具栏、保存状态、未保存标记和分屏状态必须明显但不抢内容。
- 左侧文件树要紧凑、可扫读，选中态、hover、目录展开和上下文加入入口要清楚。
- 深色模式目前是“预览”状态，重调时必须同步检查 `.theme-dark` 和 `prefers-color-scheme: dark` 分支。

不要破坏的交互：

- `⌘B` 折叠左侧栏，`⌘⌥B` 折叠右侧栏。
- 文件树右键菜单：复制相对路径、添加到 AI 上下文。
- 打开文件后会把第一个文档自动加入 AI 上下文。
- Markdown 的 `⌘S` 保存、未保存 dirty dot、关闭未保存确认。
- 右侧 Terminal 标签可双击重命名、可新建 Claude/Codex、可左右分屏、可关闭退出/错误终端。
- Tasks 可以选择 provider、Skill、上下文，运行后查看输出和 diff，并选择性应用文件修改。

## 3. UI 对应代码位置

### 3.1 全局布局和状态

- `src/renderer/App.tsx:273`：根节点、主题 class、窗口 focus/blur class。
- `src/renderer/App.tsx:282`：顶部 titlebar 和左右侧栏展开按钮。
- `src/renderer/App.tsx:296`：三栏 workspace 布局。
- `src/renderer/App.tsx:301`：左侧 Sidebar 接入。
- `src/renderer/App.tsx:324`：中间 DocumentWorkspace 接入。
- `src/renderer/App.tsx:340`：右侧 RightPanel 接入。
- `src/renderer/App.tsx:359`：SettingsPanel 弹窗接入。
- `src/renderer/hooks/usePanels.ts`：左右栏宽度、折叠、重置逻辑。
- `src/renderer/hooks/useAppearance.ts`：外观设置到 CSS 变量的桥接。

### 3.2 全局样式和主题

- `src/renderer/styles.css:4`：全局设计变量，字体、字号、颜色、线条、圆角、动效。
- `src/renderer/styles.css:83`：App shell、titlebar、workspace。
- `src/renderer/styles.css:145`：三栏 column、折叠动画、左右栏背景。
- `src/renderer/styles.css:355`：通用 icon button。
- `src/renderer/styles.css:388`：通用 text button。
- `src/renderer/styles.css:2201`：reduce motion。
- `src/renderer/styles.css:2221`：深色主题。
- `src/renderer/styles.css:2437`：系统深色模式分支。

### 3.3 左侧文件栏

- `src/renderer/components/Sidebar.tsx:34`：文件栏顶部标题、打开文件夹、收起按钮。
- `src/renderer/components/Sidebar.tsx:47`：未打开项目、加载、错误、文件树状态。
- `src/renderer/components/Sidebar.tsx:78`：底部设置入口。
- `src/renderer/components/FileTree.tsx:54`：文件/目录单行结构。
- `src/renderer/components/FileTree.tsx:60`：右键菜单回调，连接复制相对路径和加入 AI 上下文。
- `src/renderer/styles.css:325`：侧栏 section header。
- `src/renderer/styles.css:414`：文件树样式。
- `src/renderer/styles.css:480`：侧栏底部设置区。

### 3.4 中间文档工作区

- `src/renderer/components/DocumentWorkspace.tsx:115`：文档工作区和左右分屏根结构。
- `src/renderer/components/DocumentWorkspace.tsx:124`：文档 tab strip。
- `src/renderer/components/DocumentWorkspace.tsx:149`：文档左右分屏/关闭分屏按钮。
- `src/renderer/components/DocumentWorkspace.tsx:161`：Viewer 堆栈。
- `src/renderer/components/Viewer.tsx:49`：空状态。
- `src/renderer/components/Viewer.tsx:63`：按文件类型分流 PDF/Image/QuickLook/Text/Markdown/Office/Other。
- `src/renderer/components/Viewer.tsx:225`：Markdown 工具栏、保存状态、预览编辑/源码切换。
- `src/renderer/components/Viewer.tsx:280`：Markdown 源码 textarea 与预览编辑器切换。
- `src/renderer/styles.css:173`：document workspace 和 pane。
- `src/renderer/styles.css:210`：文档 tabs。
- `src/renderer/styles.css:525`：viewer、PDF、QuickLook、图片、文本、Markdown 工具栏和正文。

### 3.5 右侧 AI 工作区

- `src/renderer/components/RightPanel.tsx:93`：`settings.ai.tasksEnabled` 控制 Tasks/Terminal。
- `src/renderer/components/RightPanel.tsx:397`：右侧栏头部，Tasks/Terminal segmented switch。
- `src/renderer/components/RightPanel.tsx:425`：Terminal 标签条。
- `src/renderer/components/RightPanel.tsx:500`：右侧操作按钮：终端分屏、关闭退出终端、新建终端、收起。
- `src/renderer/components/RightPanel.tsx:544`：右侧 body。
- `src/renderer/components/RightPanel.tsx:545`：Tasks 模式接入 TaskWorkspace。
- `src/renderer/components/RightPanel.tsx:555`：Terminal 空状态 Agent chooser。
- `src/renderer/components/RightPanel.tsx:556`：Terminal tab content 和 split pane。
- `src/renderer/components/TerminalView.tsx`：xterm 实际渲染与状态回调。
- `src/renderer/styles.css:852`：右侧栏头部、Terminal tabs、Agent picker。
- `src/renderer/styles.css:1109`：Terminal 分屏和 xterm 容器。
- `src/renderer/styles.css:1586`：Tasks/Terminal 模式切换按钮。

### 3.6 Tasks 模式

- `src/renderer/components/TaskWorkspace.tsx:32`：顶部 quick tasks 文案。
- `src/renderer/components/TaskWorkspace.tsx:67`：provider、prompt、task、history、skills、context 等状态。
- `src/renderer/components/TaskWorkspace.tsx:441`：Tasks 根结构。
- `src/renderer/components/TaskWorkspace.tsx:443`：provider toolbar 和 bypass 提示。
- `src/renderer/components/TaskWorkspace.tsx:478`：任务输入区。
- `src/renderer/components/TaskWorkspace.tsx:502`：Skill 折叠区。
- `src/renderer/components/TaskWorkspace.tsx:559`：上下文折叠区和 token budget。
- `src/renderer/components/TaskWorkspace.tsx:606`：运行按钮。
- `src/renderer/components/TaskWorkspace.tsx:622`：任务运行状态、停止、重新运行。
- `src/renderer/components/TaskWorkspace.tsx:666`：任务输出流。
- `src/renderer/components/TaskWorkspace.tsx:694`：文件修改 diff 审阅和选择性应用。
- `src/renderer/components/TaskWorkspace.tsx:747`：历史任务。
- `src/renderer/styles.css:1154`：结构化 AI tasks 整体样式。
- `src/renderer/styles.css:1233`：quick task grid。
- `src/renderer/styles.css:1271`：Skill 搜索和 skill card。
- `src/renderer/styles.css:1340`：上下文 basket。
- `src/renderer/styles.css:1428`：任务状态头。
- `src/renderer/styles.css:1477`：任务输出。
- `src/renderer/styles.css:1505`：diff change list/card。
- `src/renderer/styles.css:1612`：task fold 折叠面板。

### 3.7 设置弹窗

- `src/renderer/components/SettingsPanel.tsx:176`：设置弹窗根结构。
- `src/renderer/components/SettingsPanel.tsx:202`：左侧设置分类 nav。
- `src/renderer/components/SettingsPanel.tsx:222`：通用设置。
- `src/renderer/components/SettingsPanel.tsx:243`：AI 设置。
- `src/renderer/components/SettingsPanel.tsx:274`：任务工作台开关。
- `src/renderer/components/SettingsPanel.tsx:333`：通知设置。
- `src/renderer/components/SettingsPanel.tsx:362`：终端设置。
- `src/renderer/components/SettingsPanel.tsx:428`：自定义热键。
- `src/renderer/components/SettingsPanel.tsx:504`：终端会话。
- `src/renderer/components/SettingsPanel.tsx:536`：外观设置。
- `src/renderer/components/SettingsPanel.tsx:608`：关于/Fable 5 badge。
- `src/renderer/styles.css:1714`：设置窗口整体样式。
- `src/renderer/styles.css:1782`：设置左侧 nav。
- `src/renderer/styles.css:1819`：设置 group/card/row。
- `src/renderer/styles.css:1855`：热键 row。
- `src/renderer/styles.css:2009`：终端会话列表。
- `src/renderer/styles.css:2093`：Agent card。

## 4. 建议给 Fable 5 的优先级

1. 先调整 `src/renderer/styles.css` 的设计变量、全局按钮、三栏布局、深色主题，保持组件结构不变。
2. 再优化 `RightPanel.tsx` + `TaskWorkspace.tsx`：让 Tasks 模式的信息层级更清楚，减少小卡片堆叠和视觉噪声。
3. 然后优化 `DocumentWorkspace.tsx` + `Viewer.tsx`：文档 tab、Markdown 工具栏、阅读宽度、保存状态、分屏状态。
4. 最后优化 `SettingsPanel.tsx`：设置弹窗更紧凑，nav、row、slider、toggle、热键录制和会话列表保持一致。

## 5. UI 验收清单

- 浅色、深色、跟随系统三种主题都能读清文本和状态。
- 左右栏折叠、拖拽 resize、双击 reset 不破坏布局。
- 右侧 Tasks/Terminal 切换后状态不丢失，Terminal 标签和 Tasks 输出不互相挤压。
- 右侧栏宽度在较窄状态下，provider、bypass、运行按钮、diff 文件名、历史任务文本不溢出。
- Markdown 预览编辑、源码编辑、保存状态和 dirty dot 明确可见。
- 设置弹窗在小窗口下可滚动，热键行、slider、select、输入框不重叠。
- `npm run typecheck` 和 `npm test` 通过。

## 6. 技术栈

- Runtime：Electron 42、Node.js、TypeScript ESM。
- 构建：electron-vite、Vite、SWC、React 18。
- UI：React + CSS，图标使用 `lucide-react`。
- 终端：`node-pty` + `@xterm/xterm` + `@xterm/addon-fit`。
- Markdown：`marked` 渲染、`turndown` + GFM 插件做 HTML 到 Markdown 回写。
- 测试：Vitest + jsdom。
- 打包：electron-builder，macOS arm64，本地 unsigned/not notarized。

## 7. 本地命令

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

## 8. 目录地图

- `src/main/`：Electron 主进程能力，包括窗口、IPC、文件系统、安全边界、PTY、设置、Agent Task、预览协议。
- `src/preload/index.ts`：通过 `contextBridge` 暴露 `window.studio`，是 renderer 访问主进程的唯一桥。
- `src/shared/types.ts`：共享类型和 IPC channel 合约。新增跨进程能力时先改这里。
- `src/renderer/`：React 渲染层。
- `src/renderer/components/`：主要 UI，`App.tsx` 组装三栏布局。
- `src/renderer/lib/api.ts`：renderer 侧 promise API 封装，统一 unwrap `IpcResult`。
- `test/`：主进程纯逻辑、设置、安全、diff、workspace、markdown、hotkey 等单元测试。
- `script/build_and_run.sh`：本地 macOS build/package/run/debug/verify 辅助脚本。
- `electron-builder.yml`：打包配置，`node-pty` native module 需 `asarUnpack`。

## 9. 关键架构

### 9.1 主进程入口

`src/main/index.ts` 负责：

- 创建 Electron 窗口，开启 `contextIsolation`、`sandbox`，禁用 nodeIntegration。
- 注册 `app-preview://` 和 `app-quicklook://` 两套受控预览协议。
- 初始化设置、项目状态、Agent 可用性检测、Claude Skill 能力服务、Agent Task 管理器。
- 注册 IPC：project、fs、settings、skills、agent、pty、hotkeys。
- 同步全局快捷键，并把触发事件发给 renderer。

### 9.2 文件访问安全

所有文件读写和预览都应经过 `src/main/security.ts` 的 `resolveWithinRoot()`：

- 先解析项目 root 和目标路径真实路径。
- 对 symlink 做 realpath 校验。
- 目标不存在时解析最近存在父目录再做边界检查。

这条边界很重要，新增文件/预览/导出能力时不要绕过。

### 9.3 文档工作区

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

### 9.4 右侧 AI 工作区

主要文件：

- `src/renderer/components/RightPanel.tsx`
- `src/renderer/components/TaskWorkspace.tsx`
- `src/renderer/components/TerminalView.tsx`
- `src/main/pty.ts`

行为：

- 右侧提供 Tasks/Terminal 双模式，Tasks 可在设置中关闭。
- Tasks 使用结构化 Agent Task：隔离工作区、流式输出、diff 审阅、选择性应用。
- 终端在真实项目目录内启动，不是隔离工作区。
- Claude 启动命令默认 `claude --dangerously-skip-permissions`。
- Codex 启动命令默认 `codex --dangerously-bypass-approvals-and-sandbox`。
- `createPtyEnvironment()` 会清理当前 Codex/Claude 环境变量，设置 UTF-8 locale 和 truecolor。

### 9.5 结构化 Agent Task

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

### 9.6 Claude Skill 发现

`ClaudeCapabilityService` 会合并：

- 内置技能：batch、code-review、debug、loop、claude-api。
- 用户技能：`~/.claude/skills/**/SKILL.md`。
- 项目技能：`<project>/.claude/skills/**/SKILL.md`。
- Claude plugin 技能：通过 `claude plugin list --json` 和 `claude plugin details` 解析。

合并策略按 command 去重，排序优先级为 project、user、plugin、bundled。

## 10. 设置和持久化

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

## 11. 打包和平台注意事项

- 目标平台当前是 macOS Apple Silicon / arm64。
- `electron-builder.yml` 明确 unsigned：`identity: null`。
- 产物在 `dist/`，例如 `dist/mac-arm64/Studio.app`。
- `node-pty` native binding 必须 unpack：`asarUnpack: "**/node_modules/node-pty/**"`。
- QuickLook 和 HEIC 预览依赖 macOS 系统工具：`qlmanage`、`/usr/bin/sips`。
- 未签名 build 首次打开会触发 Gatekeeper 提示，这是预期行为。

## 12. 当前工作区状态

交接时 `git status --short` 显示已有未提交图标资源改动：

- `build/AppIcon.iconset/*.png`
- `build/icon-cropped.png`
- `build/icon-source.png`
- `build/icon.icns`

这些不是本交接文件产生的改动。接手时请先确认这些图标变更是否要保留、提交或丢弃。

本交接新增文件：

- `FABLE_HANDOFF.md`

## 13. 接手优先事项

1. 核实 Tasks UI 端到端  
   当前 renderer 已有 `TaskWorkspace`，但仍建议运行真实 Claude/Codex 任务，确认 start、stream、diff、apply、discard、history 都可用。

2. 做一次真实 app 验证  
   运行 `script/build_and_run.sh --verify`，打开项目目录，验证文件树、Markdown 保存、PDF/图片预览、QuickLook、Claude/Codex 终端启动。

3. 验证 Agent Task 端到端  
   如果要继续结构化任务能力，需要补或恢复 renderer UI，并做一轮真实 Claude/Codex 任务、diff 展示、选择性 apply、冲突保护测试。

4. 明确 bypass 默认值  
   交互终端和结构化任务默认都偏向 bypass。若要给普通用户分发，建议重新审视默认安全策略和 UI 提示。

5. 梳理 README 与实际 UI  
   README、Fable badge、设置关于页和实际 UI 要保持一致，避免后续接手者按过期入口排查问题。

6. 扩充集成测试  
   单元测试覆盖不错，但 Electron UI、预览协议、PTY、QuickLook、真实 agent CLI 仍主要靠手测。

## 14. 改动入口速查

- 新增 IPC 能力：先改 `src/shared/types.ts`，再改 `src/preload/index.ts`、`src/renderer/lib/api.ts`、`src/main/index.ts`。
- 新增文件类型预览：改 `src/renderer/lib/fileKind.ts`、`src/renderer/components/Viewer.tsx`，必要时改 `src/main/preview.ts` 或 `quickLook.ts`。
- 改 agent 命令参数：`src/main/agentCommand.ts`。
- 改隔离工作区策略：`src/main/workspace.ts`。
- 改 diff/apply 冲突策略：`src/main/workspaceDiff.ts` 和 `src/main/agentTaskManager.ts`。
- 改设置 schema：`src/shared/types.ts`、`src/main/settings.ts`、`src/renderer/components/SettingsPanel.tsx`，并补 `test/settings.test.ts`。
- 改快捷键：`src/shared/hotkeys.ts`、`src/shared/hotkeyPresets.ts`、`src/main/index.ts`、`src/renderer/App.tsx`。

## 15. 建议交接验收清单

- `npm install` 后可正常 `npm run typecheck`。
- `npm test` 全绿。
- `npm run dev` 可启动开发 app。
- `script/build_and_run.sh run` 可生成并打开 unsigned `Studio.app`。
- 打开一个项目目录后，文件树不会显示 `.git`、`node_modules`、`dist`、`out` 等忽略项。
- Markdown 可以编辑和保存，普通文本不会误写。
- PDF/图片/Office/HEIC 预览路径不会越过项目 root。
- Claude/Codex CLI 在右侧终端能启动，并在项目根目录。
- 如果恢复 Tasks UI，agent 任务 apply 不会覆盖任务期间用户手动改过的源文件。
