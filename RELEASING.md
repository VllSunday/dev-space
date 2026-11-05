# Releases

`scripts/publish-github.mjs` publishes this independent source checkout using the
existing GitHub CLI login. Run it from a terminal with normal GitHub connectivity:

```powershell
node scripts/publish-github.mjs
```

The script creates `VllSunday/dev-space` as a private repository if it is absent,
checks the owner and independent history, pushes `main` and the version tag, and
waits for `.github/workflows/release-build.yml`. It does not change proxy settings,
copy access tokens, force-push, or alter the old local checkout.

The workflow uses the original project's packaging approach with the new product
name, executable and icons:

| Platform | Runner | Packages |
|---|---|---|
| Windows x64 | windows-latest | NSIS installer, launcher, portable ZIP with runtime |
| Linux x86_64 | ubuntu-22.04 | launcher, AppImage, portable tar.gz with runtime |
| macOS Apple Silicon | macos-15 | DMG and app ZIP |
| macOS Intel | macos-15-intel | DMG and app ZIP |

Build jobs have read-only repository access. Only the final publication job can
write release assets. It runs after all four native builds succeed and includes
`SHA256SUMS.txt`. Packages contain the app's MIT notice, third-party notices and
the packaged runtime's licenses. macOS uses ad-hoc signing; no Apple Developer
certificate or notarization credentials are included.

The publishing script verifies the uploaded source, expected release packages,
and SHA-256 of every downloaded package. Only then does it remove the explicitly
requested old fork `VllSunday/workspace-for-game-dev`, after checking its fixed
repository ID, owner and fork status. A failed build, download or checksum leaves
that fork in place. Insufficient GitHub delete permission also leaves it intact.
The old local source and uncommitted work are always preserved.

Results are saved locally to `release/publication-result.json`; downloaded
packages are stored in `release/github-vVERSION/`. Both stay outside Git.

For later releases, update the version in package.json, package-lock.json,
src-tauri/Cargo.toml, Cargo.lock and tauri.conf.json, commit the reviewed changes,
and push a new `vMAJOR.MINOR.PATCH` tag. The workflow can also rebuild an existing
tag through its `workflow_dispatch` input. Never reuse a version tag for different
source code.
