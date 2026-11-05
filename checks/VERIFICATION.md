# Verification record

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
