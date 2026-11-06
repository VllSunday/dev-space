# Shell palette and skills folders

The screenshot's duplicate composer outline came from the shared named-theme
focus rule overriding the embedded conversation rule. The legacy theme component
also writes pink root tokens inline, overriding old :root aliases.

The mounted desktop shell now owns local color aliases on `body.devspace-shell`,
including portalled controls. It is applied before paint and removed on unmount.
Saved palette choices, report iframe content, CLI colors, provider logos and
explicit tab/group colors are not rewritten. The composer has no inner focus
outline or glow; other interactive controls retain a visible blue-gray focus.

Skills previously navigated to `.claude/skills` under the application repo
unconditionally. `/skill-locations` now reports provider, personal/project scope,
actual folder path and existence without creating folders. Project roots follow
the selected document project. The browser chooses an existing root when present,
offers other roots and shows an explicit empty state when missing. Personal
Claude roots are included in the context library; legacy root precedence and
credential restrictions remain intact.

TypeScript, the targeted ESLint error check and 17 related service tests passed.
The isolated UI check contains a focus/palette regression assertion, but browser
launch is blocked in this environment (spawn EPERM); no rendered UI pass is
claimed. Packaging verifies all file checksums, includes the new service module
and smoke-tests skill discovery against isolated data without launching a CLI.
