# Dev Space 1.0.1 — full-window layout

The desktop host (`.desktop-root`) is a horizontal flex container. The new grid
shell had the default `flex: 0 1 auto`, an automatic width and no minimum-width
override. It therefore retained its intrinsic content width rather than using
the available native window, leaving a large unused area on wide displays.

The shell now has `flex: 1; min-width: 0; width: 100%`. Its existing grid,
responsive sidebar, resizable agent pane and flexible canvas are preserved.

Validation on 2026-11-05:

- TypeScript and production Vite build passed.
- Offline Rust release build passed for 1.0.1.
- The generated distribution and packaged runtime both contain the corrected
  shell declarations; the portable UI stylesheet matches the distribution hash.
- `node checks/layout-ui.mjs` exercises the actual app at 960, 1280, 1920 and
  2560 pixels, with expanded/collapsed navigation and open/closed agent panels.
  It could not run here: Edge launch failed with `spawn EPERM`. The geometry
  assertions and native visual verification are therefore **not reported as
  passed**.

No user workspace or agent session was modified or stopped. Install the 1.0.1
update after closing Dev Space normally, then reopen it to load the new UI.
