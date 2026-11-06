# Existing material images and deletion

The expanded record and quick-view dialog share `MaterialAttachments`. It handles
file selection, pasted clipboard files, browser drops and native file-drop events
inside its area. Uploads are stored as local assets, recoverable draft references
are saved before attaching, and the typed `material-files` operation appends or
detaches paths without replacing text or other attachments. Removal preserves
asset bytes and other material references. SVG and AVIF are recognized images.

The expanded editor receives focus inside the attachment area, so paste is routed
to the existing note rather than the new-note composer. Pending saves keep the
material ID they started with if the user changes routes. Retry is available for
uploaded files that could not be attached.

Delete appears in the summary row, expanded record, quick view and bulk toolbar.
`delete-materials` is atomic, clears collection/source references and preserves
files. Undo restores original IDs, content, attachments and links. The toast only
offers undo while that deletion is still the last store revision. Archive remains
an independent action.

TypeScript, targeted ESLint error checks and 22 related service/model tests passed.
`checks/material-edit-ui.mjs` provides a synthetic integration scenario for file
selection, native drop routing, detach and bulk delete/undo. Browser automation is
blocked by the environment's spawn EPERM; no rendered verification is claimed.
The local distribution is checksum-verified and smoke-tested with isolated data.
