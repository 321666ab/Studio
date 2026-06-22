# Studio

A local Electron document workbench. These instructions cover running,
verifying, and packaging the app on macOS (Apple Silicon / arm64).

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
