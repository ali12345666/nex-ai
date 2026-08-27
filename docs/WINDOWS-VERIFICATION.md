# NEX AI — Windows 10/11 Verification Checklist (Phase 8 / P8-D)

The sandbox CI runs on Linux. Windows must be verified on a **real Windows 10/11
machine** before any release claim. This checklist is the contract.

## Automated coverage added in P8-D (runs on any OS)

| Check | Where |
|---|---|
| `npm`/`npx`/`yarn`/`pnpm`/`bun` resolve to `.cmd` shims on win32 | `tests/glm/test-p8d.ts` §1 |
| cmd.exe metacharacter args (`& \| < > ^ % "` newline) are blocked whenever a shell is forced | `tests/glm/test-p8d.ts` §2 |
| No `/`-concatenated paths in new Phase 8 code (path.join everywhere) | `tests/glm/test-p8d.ts` §3 |
| PowerShell spawn for the integrated terminal on win32 | `src/main/security/shell.ts` |
| System32 write-block on win32 | `src/main/main.ts` (`isPathBlocked`) |
| Portable mode data dir next to `.exe` | `src/main/persistence/index.ts` |
| NSIS + Portable x64 build targets + icon | `package.json` (`build.win`) |

## Manual checklist (run on Windows 10/11 x64)

### 1. Electron shell
- [ ] `npm install --legacy-peer-deps` completes (electron postinstall downloads win binary)
- [ ] `npm run dev` opens the app window (Vite + Electron)
- [ ] Custom title bar, command palette (Ctrl+P), terminal toggle (Ctrl+`)

### 2. llama.cpp (local inference)

**2a. Vulkan GPU binary (REQUIRED for GPU offload on Windows)**

node-llama-cpp ships GPU backends as **separate optional packages**. A plain
`npm install` pulls in the CPU binary (`@node-llama-cpp/win-x64`) but NOT the
Vulkan binary (`@node-llama-cpp/win-x64-vulkan`). Without the Vulkan binary,
NEX AI silently falls back to CPU even when `npx node-llama-cpp inspect gpu`
reports "Vulkan AVAILABLE" (that command checks driver availability for the
platform, not whether the binary is installed in this project).

- [ ] Install the Vulkan binary into the project:
      ```bat
      cd <nex-ai project root>
      npx node-llama-cpp download --gpu vulkan
      ```
- [ ] Confirm the binary package now exists:
      ```bat
      dir node_modules\@node-llama-cpp\win-x64-vulkan
      ```
      (must contain a `.node` / `.dll` native file, not be empty/absent)
- [ ] If packaging with electron-builder, ensure `node-llama-cpp` and the
      `@node-llama-cpp/*` packages are **unpacked** from asar (native modules
      cannot load from inside an asar archive). Add to `build.asarUnpack`:
      ```json
      "asarUnpack": ["node_modules/node-llama-cpp/**", "node_modules/@node-llama-cpp/**"]
      ```

**2b. Model load + GPU-offload PROOF (do not skip — this is the real test)**

- [ ] Settings → Local AI → add a `.gguf` model (e.g. Qwen2.5-0.5B Q4_K_M)
- [ ] Open the NEX AI dev console (or check `%APPDATA%/nex-ai/logs`).
- [ ] Load the model. Look for the **`[GPU_RUNTIME]`** block — verify:
      - `backend=vulkan` (NOT `cpu`)
      - `buildType=prebuilt`
      - `supportsGpuOffloading=true`
      - `gpuDeviceNames=` lists `NVIDIA GeForce RTX 4060`
- [ ] Immediately after, look for the **`[GPU_MODEL_LOAD]`** block — verify:
      - `gpuLayersActual=` is **> 0** (e.g. 41 for a 30B model)
      - `vramAfter` > `vramBefore` (the VRAM delta is non-zero)
      - `llamaMemoryUsage=` shows `gpuVram=` in the **GB range** for a multi-GB model
      - `gpuOffloadProven=YES`
      - If you see `gpuOffloadProven=NO`, the Vulkan binary is missing or the
        model is too large for VRAM — do NOT claim GPU inference works.
- [ ] Send a chat message. Look for **`[GPU_INFERENCE]`** — verify
      `backend=vulkan` and `gpuLayersActual=>0` and `modelInstanceSame=YES`.
- [ ] **External cross-check (the ground truth):** Open Task Manager →
      Performance → GPU. Note VRAM "Dedicated GPU memory" **before** loading
      the model (~768 MB with just the display). Load the model and send one
      message. VRAM **MUST increase** by roughly the model size (e.g. a 4-bit
      8B model → +4–5 GB; a 4-bit 30B model → +18 GB on an RTX 4060 8GB will
      partial-offload: `gpuLayersActual` will be < total layers and RAM will
      still grow, but VRAM MUST move off the 768 MB baseline).
- [ ] If VRAM does NOT increase, GPU offload is NOT happening. Re-check 2a.

**2c. CPU fallback path (still must work)**
- [ ] On a machine without Vulkan, or after uninstalling the Vulkan binary,
      NEX AI must still load the model and produce tokens (CPU path).
      The `[GPU_RUNTIME]` block should show `backend=cpu` and
      `[GPU_MODEL_LOAD]` should show `gpuOffloadProven=NO` — this is
      expected and correct on CPU-only systems.

### 3. GLM 5.3 integration
- [ ] Settings → Online AI → GLM 5.3 selected (default)
- [ ] Paste z.ai (or open.bigmodel.cn) API key → Save → restart app → key persists
- [ ] `%APPDATA%/nex-ai/config.json` contains NO API key (only settings)
- [ ] Secrets encrypted via DPAPI (secrets.json unreadable between users)
- [ ] AI Mode = Online → chat answers via glm-5.3
- [ ] AI Mode = Auto, no local model → routing decision logs "online (GLM 5.3)"
- [ ] Agent coding task with online backend → plan + steps execute

### 4. Filesystem tools (Phase 8 P8-C)
- [ ] `read_files` with relative paths (backslash AND forward-slash inputs)
- [ ] `project_structure` ignores `node_modules`, shows manifest
- [ ] `propose_changes` → Diff review UI → Accept → file written
- [ ] Path traversal attempt (`..\..\outside`) blocked by permission layer

### 5. PowerShell / commands
- [ ] Integrated terminal opens PowerShell (`-NoLogo -NoProfile`)
- [ ] `npm_build` / `npm_test` tools succeed (via npm.cmd shim)
- [ ] Injection attempt through script name (`build&calc`) is BLOCKED
- [ ] `run_command` allowlist: `git`, `node`, `npm` work; others require approval

### 6. Diff application
- [ ] Multi-file propose_changes → review each file → Accept all → all written
- [ ] New-file creation works (before = empty)
- [ ] Reject leaves disk untouched

### 7. Secret storage
- [ ] safeStorage available (DPAPI) — Settings shows "encrypted storage active"
- [ ] Restart persistence: settings + keys survive app close/reopen
- [ ] Portable build: `NEX-AI-Portable-x.y.z.exe` keeps data next to the exe

### 8. Installer
- [ ] `npm run package:win` produces `release/NEX-AI-Setup-1.0.0.exe`
- [ ] Install (per-user, no elevation required) → Desktop + Start Menu shortcuts
- [ ] Uninstall removes app but ASKS about user data

## Known Windows-specific behavior (by design)

- `.cmd` shims (npm/npx/yarn/pnpm/bun) spawn with `shell:true` — the binary
  name is OURS (whitelisted), and any argument containing cmd.exe
  metacharacters is rejected before spawn (`isShellSafeArg`).
- Terminal spawns `powershell.exe -NoLogo -NoProfile` (not cmd.exe).
- All filesystem tools are root-jailed via `assertPathInside` with
  `path.resolve` — mixed-separator inputs normalize correctly.
