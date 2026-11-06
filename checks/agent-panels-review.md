# Agent panel polish — local preview

The user's screenshots show fixed-height toolbars wrapping over content, native
black scrollbar tracks, bordered one-line composer scrollbars, a reconnect notice
moving one composer's baseline, and a sidebar divider following the space count.

The final cascade is in `src/devspace/agent-panels.css`. The spaces sidebar now
uses equal grid tracks with separate scrolling. Agent headers respond to their
own pane width; tabs and status rows keep stable heights. Reconnect notices sit
above the conversation/terminal body. The composer removes general-field styles
and measures content on pane resize as well as text changes. Embedded terminals
receive the panel background through xterm's theme API, retaining ANSI colors.

Follow-up: the document shell and its toolbar now share the chat/Wiki canvas
background. The supplied screenshot confirms both navigation rails already use
the same #101114; #131518 is the content surface. Resize handles now paint a
visible 1px divider on each split axis with a 7px interactive target, retaining
existing drag and keyboard behavior.

Verification: TypeScript and production Vite build pass; 21 related tests pass,
including the embedded background and ANSI preservation check. Existing session
and conversation-view checks cover stable identity, history and input behavior.
Native release build and distribution checksum verification are recorded by the
local packaging manifest. No real agent process is stopped for installation.

`checks/agent-panels-ui.mjs` is an isolated, synthetic four-pane fixture checking
equal sidebar tracks after adding spaces, toolbars staying in their rows, equal
composer baselines despite reconnect warnings, and terminal switching. Its
browser could not launch in this environment (`spawn EPERM`), so no rendered or
native UI pass is claimed. User screenshots are the visual defect evidence.
