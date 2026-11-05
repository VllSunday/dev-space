# Dev Space desktop

The Node service hosts the project store, real CLI sessions, file handling and
dictation. The Tauri shell creates one native window and packages that service
with its own Node runtime. Project content and `.devspace` state stay outside the
application bundle.

See [README](../README.md) for usage and [RELEASING](../RELEASING.md) for native
Windows, Linux and macOS release packages.
