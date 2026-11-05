# Verification record

## Version 1.0.5

The optional bundled game template is included under desktop/service/templates,
using the pristine generated seed rather than the user's edited workspace.
The focused suite passed 40 tests, skipped one child-process regression blocked
by the environment, and failed none. Template tests cover independent IDs and
asset copies, imported page editing, retained existing content, duplicate imports,
undo/restart, rejected template paths and stale-revision requests before writes.
Both template tests passed again after adding the page-edit assertion.

TypeScript/Vite (403 modules) and the offline Rust release build passed.
The release workflow validates the new first-run and project-dialog buttons with
checks/template-ui.mjs, including Wiki navigation, a bundled GLB and no automatic
agent launch. That new fixture was not run locally; the user declined further
manual browser checks after the previous full pass. A bounded independent static
review found no material blocker; see template-finish-review.md.

README screenshots were captured from the actual installed 1.0.4 native app,
maximized at 2560x1392. They show four live Codex/Claude terminal sessions, the
Wiki and tool settings, a loaded/rotated GLB, and centered appearance/dictation
settings. These confirm the final 1.0.4 centering/icon fixes in the native UI,
but do not prove the new 1.0.5 template buttons. No terminal task, model,
permission, login, microphone or speech provider was changed for screenshots.

The user's live projects were not copied into Git. Only the explicitly authorized
pristine teaching template and selected application screenshots are public source.
Native Linux/macOS build and download verification remain release-job results,
not local Windows test results. Public repository visibility requires an explicit
--public publishing choice; without it, the publisher preserves visibility.

## Version 1.0.4

The production TypeScript/Vite build passed with 403 modules. The offline Windows
Rust release build and NSIS packaging passed. The focused unit suite ran in one
Node process because this agent environment rejects child-process test isolation:
47 passed, three skipped, zero failed (50 total). The skips cover optional local
Whisper fixtures and the process-based release buffer regression.

The user executed scripts/check-release-ui.mjs in a normal Windows session.
All four browser checks passed: full-window layout, agent panes/fonts/tool drawer,
GLB viewing and Wiki navigation. The recorded UI index SHA-256 for that run is
667f0053cb6d1ad3c9c37d749a15bd692c9081363460ae94e11b1d5f5ebe1aa1.
The checks exercised pointer widening AND narrowing, saved drawer size, Graphite
aliases, font upload, 3D rendering, eight home previews, target-record scrolling,
inline edits, image-only galleries, history after reload and a delayed Markdown
save across unmount/remount with a newer draft.

This run caught history being cleared by bootstrap credential removal and a test
selector expecting textbox rather than the actual font combobox. Both were fixed
before the passing run. The source-only finish reviewer also identified a stale
Markdown tombstone, history reinitialization and duplicate image keys; all three
fixes are included. The detector was not rerun after the bounded review.

A single batched screenshot review found that settings lacked explicit dialog
centering and the fixture mobile capture had reopened agents rather than showing
Wiki. Dialog positioning and the capture were corrected. The production build
also now copies the public app icon explicitly, without copying private workspace
files. These final visual/capture changes passed TypeScript/Vite and packaging;
a second browser confirmation has not been run yet. Do not treat the earlier
passing UI hash as proof of this later render.

Current publication remains a separate step: Linux/macOS packages and a GitHub
Release are only complete after native Actions jobs and asset verification pass.
Microphone capture and actual transcription were not exercised in this pass.

## Version 1.0.3

The production TypeScript/Vite build passed with 397 modules. The focused
48-test suite passed 46 tests and skipped two optional local-dictation tests.
After adding saved drawer width and transcript compatibility assertions, all
12 affected tests passed. The PowerShell updater fixture passed without
terminating a process or modifying an installation. The new drawer's static
design detector returned zero findings.

The workbench browser check now covers pointer and keyboard resizing, persisted
tool width, retaining a wide preference across narrow viewports, all three tools
tabs and inherited Graphite tokens. It is wired into release CI; it was not run
in this local session because browser launch was previously denied with EPERM.
The README illustration is a schematic with generic content, not a screenshot;
its SVG was parsed successfully. The local game example remains excluded.

Visible product names were updated in backend errors, mobile manifest, help and
coordinator identity text. Models, permission rules and identity-independent
behavior were preserved. Historical handoff messages remain recognized by their
fixed request body. LICENSE is unchanged.

## Version 1.0.2

The new pane/font/Whisper tests and focused existing project, activity, language,
appearance and Markdown tests passed (40 tests, then all 13 project tests passed
after adding cross-project home/model-link validation). Four independent session
subscriptions and stale-snapshot protection are exercised through real local
HTTP/WebSocket services without launching agents. Font upload, authorization,
deduplication, removal and partial setting updates are covered. Whisper setup
checks configuration before saving and preserves unrelated environment keys.

The production TypeScript/Vite build passed with 396 modules. The offline Windows
Rust release build passed for 1.0.2. Local Draco decoders and the Three.js license
are included in packaged UI. The actual existing Python environment successfully
loaded local large-v3 in CUDA/float16 using the worker's --check mode; microphone
capture and speech transcription were not tested, and no user configuration was
changed by that check.

Pane interaction and model-viewer browser checks are added to the Windows release
workflow. They have not been executed in this restricted local session because
browser process launches previously failed with EPERM. The bounded independent
finish review therefore inspected code, not screenshots. Its material fixes were
applied, including preserving explicit selection intent while closing a tab.
The static design check reported advisory token/type-ramp differences.

The local-only example contains six pages, 12 materials, six example tasks,
an original generated illustration, a vector map and three GLB blockouts. Its GLBs
parsed successfully through the production Three.js loader. A fixture import
preserved the existing project and checked every local asset. All example content
and generators stay under ignored local cache or user workspace, never Git or
the normal application distribution.

## Local Windows build

The TypeScript/Vite production build and offline Rust release build passed.
The Windows 1.0.1 NSIS installer and portable package were produced. The layout
fix is present in the distribution and packaged UI stylesheet; native screen
geometry was not verified because browser launch failed with `spawn EPERM`.
The existing Dev Space window was observed through native accessibility; that
observation alone is not a full visual or interaction check.

The focused project, draft, proposal, dictation-settings, conversation and
chat-group suite ran 29 tests: 27 passed and two local dictation checks skipped.
Real microphone input and Whisper transcription were not exercised.

## Release preparation

A broader Windows unit run executed 225 tests: 200 passed, 17 failed, eight
skipped. Three failures were outdated fixture paths following the change from
`.mrmak` to `.devspace`. Those fixtures were corrected, and all 13 tests in the
three affected files then passed. Remaining failures involve blocked process or
PTY launches (`spawn EPERM` or ConPTY pipe access). The full suite is not claimed
to pass locally. Each native release runner executes it again without suppressing
failures.

The release workflow's YAML, job dependencies, matrix, read/write permissions and
package names were validated locally. The publishing helper passed Node syntax
validation. These are configuration checks, not completed Linux/macOS builds.

Linux x86_64, macOS arm64 and macOS x64 packages require their GitHub Actions
runners. Publication is not complete until those jobs and the final upload job
succeed. The publishing helper verifies the source, asset inventory and all
downloaded SHA-256 checksums before removing the specifically requested old fork.

CLI access to GitHub in this agent session is blocked by a refused connection to
the configured proxy `127.0.0.1:9`. No proxy or security setting was changed to
bypass it. Run the prepared publishing helper from the user's normal terminal.
