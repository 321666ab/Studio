# Studio

![Built & reviewed with Claude Fable 5](https://img.shields.io/badge/Built%20%26%20reviewed%20with-Claude%20Fable%205-D97757)

A local Electron document workbench. These instructions cover running,
verifying, and packaging the app on macOS (Apple Silicon / arm64).

## AI workspace

The right sidebar has two modes (switchable at the top of the panel):

- **Tasks** runs Claude Code or Codex non-interactively inside an isolated
  temporary workspace. Skills and context files can be attached, output
  streams into the sidebar with a task history, and file changes can be
  reviewed and selectively applied back to the project with hash-based
  conflict protection. The Tasks workspace can be disabled entirely under
  设置 → AI → 任务工作台, which reverts the right sidebar to terminal-only.
- **Terminal** preserves direct Claude/Codex CLI sessions, tabs, and split
  panes. These sessions continue to launch in bypass mode inside the real
  project directory. The terminal renders with GPU acceleration, correct
  CJK/emoji widths, clickable `http(s)` links, and adjustable font family,
  size, line height, and letter spacing.

Open **Studio → 设置…** or press `⌘,` to configure the default agent, optional
model identifiers, bypass behavior, task timeout, notifications, terminal
display, and appearance. Settings are stored as versioned JSON under Electron's
macOS user-data directory.

`⌘P` opens the quick-open palette (fuzzy file-name search with recent files
first); `⇧⌘F` switches it to project-wide content search, which runs in the
main process, skips binary and oversized files, and highlights matched lines.
Open tabs, split panes, and the active document are persisted per project and
restored on relaunch (tabs whose files vanished are dropped). The file tree
watches the project via FSEvents and refreshes expanded directories
automatically when files change on disk — e.g. while an agent edits the
project from the terminal.

The file tree supports a native right-click action for copying a project-relative
path or adding a file/directory to the AI context basket. The Tasks view discovers
Claude bundled, user, project, and installed-plugin Skills, shows a 24K-token
context budget, and records the selected Skill/context with each task. Large
non-Git projects use a context-scoped temporary workspace instead of failing at
the full-project copy limit. Binary context documents (PDF/Word/RTF/ODT) are
extracted to plain-text `.extracted.txt` siblings inside the isolated workspace
using macOS-native PDFKit/`textutil`, and the task prompt directs the agent to
read those instead — required for OpenAI-compatible third-party endpoints
(e.g. 火山引擎 ARK) that reject Anthropic `document` content blocks. The preview area displays PNG/JPEG directly and
converts HEIC/HEIF through the macOS `sips` utility into a cached PNG preview.

> **Unsigned build notice.** The local package produced here is **not
> code-signed** and **not notarized**. macOS Gatekeeper may warn on first
> launch. This is expected for local development builds.

## Run

Build the bundles, package an `arm64` `Studio.app`, and launch it:

```sh
script/build_and_run.sh run
```

### Debug

```sh
script/build_and_run.sh --debug
```

When no packaged app exists, this starts the dev server (`electron-vite dev`).
When a packaged app exists, it launches the binary under `lldb`.

### Logs / telemetry

```sh
script/build_and_run.sh --logs        # tail the most recent Studio log
script/build_and_run.sh --telemetry   # show process/resource info while running
```

## Verify

Build, package, launch, then confirm the process is running via `pgrep`:

```sh
script/build_and_run.sh --verify
```

## Package

Packaging is performed by the run/verify actions via the project-local
`electron-builder`. The build
configuration lives in `electron-builder.yml`:

- product name: **Studio**, appId `com.local.studio`
- mac target: `arm64`, outputs both a `dir` app bundle and a `dmg`
- `asar` enabled, with `node-pty` native module unpacked
- unsigned local build (`identity: null`) — not notarized

Output is written to `dist/` (e.g. `dist/mac-arm64/Studio.app`).

## App icon

The icon is the original artwork (`build/icon-artwork.png`) composited into a
liquid-glass squircle by the template `build/icon.svg.tmpl`. Regenerate
`build/icon.svg`, `icon-source.png`, the `AppIcon.iconset` sizes, and
`icon.icns` with:

```sh
script/generate_icon.sh
```

## Attribution

This project was handed over to and is maintained with **Claude Fable 5**
(Anthropic). The badge above and the note in 设置 → 外观 → 关于 record that the
code was built and reviewed with Fable 5; this is a project annotation, not an
official Anthropic certification.
