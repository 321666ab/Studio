# Studio

A local Electron document workbench. These instructions cover running,
verifying, and packaging the app on macOS (Apple Silicon / arm64).

## AI workspace

The right sidebar has two modes:

- **Tasks** runs Claude Code or Codex non-interactively inside an isolated
  temporary workspace. The current document can be attached as context, output
  streams into the sidebar, and file changes can be reviewed and selectively
  applied back to the project with hash-based conflict protection.
- **Terminal** preserves direct Claude/Codex CLI sessions, tabs, and split
  panes. These sessions continue to launch in bypass mode inside the real
  project directory.

Open **Studio → 设置…** or press `⌘,` to configure the default agent, optional
model identifiers, bypass behavior, task timeout, notifications, terminal
display, and appearance. Settings are stored as versioned JSON under Electron's
macOS user-data directory.

The file tree supports a native right-click action for copying a project-relative
path or adding a file/directory to the AI context basket. The Tasks view discovers
Claude bundled, user, project, and installed-plugin Skills, shows a 24K-token
context budget, and records the selected Skill/context with each task. Large
non-Git projects use a context-scoped temporary workspace instead of failing at
the full-project copy limit. The preview area displays PNG/JPEG directly and
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
