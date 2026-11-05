# Dev Space help

Dev Space brings project materials, editable documents and a separate agent workbench into one window.

Create a project and topic, write a note, paste an image or drop a file. Ctrl+Enter saves a material. Pages support blocks, Markdown and a Wiki overview. Mark a page as Home to open it when entering the project.

Open an installed agent CLI or a local terminal. Split the workbench into up to four panes and move tabs between them. Ctrl+Shift+O splits right, Ctrl+Shift+E splits down, Ctrl+Shift+X removes a pane and Ctrl+Shift+Z zooms it. Removing a pane does not stop its agents. Ctrl+J hides the agent area.

The tools button opens Files, Skills and MCP. Drag the panel's left edge to resize it; the width is remembered. Focus the divider with Tab and use arrow keys, or Home to reset its width. Skills can be read or edited as SKILL.md files. MCP checks use a separate temporary connection.

Settings include separate interface and terminal fonts, font uploads and application zoom. To connect local Whisper, choose a Python interpreter with faster-whisper and a compatible CTranslate2 model.bin. Select Auto, CPU or NVIDIA CUDA, then Check and connect. Ctrl+Shift+Space starts or stops dictation. Escape cancels it. The transcript remains an unsent draft. No automatic switch to a paid provider occurs.

Project content lives under workspace/devspace; settings and sessions live under .devspace. Credentials, conversations, personal projects, local examples and model weights are excluded from Git and standard packages.
