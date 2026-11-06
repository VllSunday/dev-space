# Local agent spaces — local preview

Confirmed direction: agent spaces and chats on the left; project navigation,
documents, Wiki and files on the right. Spaces are independent from projects.
Original flat outline icons, vendor logos and original app assets are retained.

Implemented: create/rename/color/group spaces, group rename/collapse, drag reorder,
open-agent counts, transfer chats without changing cwd/native IDs or restarting,
separate per-space pane layouts. Existing agents remain in the original local
space; the last selected project's pane layout is copied on first setup.
Handoff continuations inherit their source space before completion is announced.
The optional Wiki composition and earlier editor changes are included.

Validation: TypeScript, production Vite build, offline native Windows release
build and 34 scoped tests passed. ESLint for the new sidebar passed. Existing
legacy files still have broader lint findings; a full clean lint is not claimed.
Distribution checksums and an isolated smoke test use the packaged service and
bundled Node. They do not exercise a real CLI process or native UI interaction.

A bounded independent static finish review identified two material defects:
handoff assignment bypass and inaccessible collapsed groups on narrow windows.
Both were fixed. No visual review is claimed: Playwright could not launch
(spawn EPERM), and Computer Use stopped because it could not reliably verify
the browser URL. No screenshots were captured.

This is a local preview using the existing 1.0.7 base version. It is not a
published release. The launcher verifies the staged runtime, waits for the user
to exit the running app through its tray, keeps a backup, and opens the updated
copy. No running agent is stopped by the installer.
