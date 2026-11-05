"""Local packaging helper. Existing dependencies are copied, never installed or downloaded."""
from pathlib import Path
import shutil
from PIL import Image
root=Path(__file__).parents[1]
image=Image.open(root/'public/assets/dev-space.png').convert('RGBA')
icons=root/'src-tauri/icons'
for size in [32,128,256]:
 image.resize((size,size),Image.Resampling.LANCZOS).save(icons/f'{size}x{size}.png')
image.save(icons/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
image.save(icons/'icon.icns')
shutil.copy2(icons/'icon.ico',icons/'chats.ico')
shutil.copy2(icons/'128x128.png',icons/'chats-128x128.png')
for size in [192,512]:image.resize((size,size),Image.Resampling.LANCZOS).save(root/f'public/assets/mak-mobile-{size}.png')
runtime=root/'.cache/desktop-runtime'
runtime.mkdir(parents=True,exist_ok=True)
node=shutil.which('node')
if not node:raise RuntimeError('Install Node or use npm run desktop:prepare.')
shutil.copy2(node,runtime/'node.exe')
for p in (root/'desktop/service').iterdir():
 if p.name in ['test','.cache']:continue
 if p.is_dir():shutil.copytree(p,runtime/'service'/p.name,dirs_exist_ok=True)
 else:shutil.copy2(p,runtime/'service'/p.name)
ui=runtime/'ui'
if ui.exists():
 assert ui.resolve().is_relative_to(root.resolve()),'Generated UI must stay inside project'
 shutil.rmtree(ui)
shutil.copytree(root/'dist',runtime/'ui')
shutil.copytree(root/'public/assets',runtime/'ui/assets',dirs_exist_ok=True)
for name in ['brand-star-source.jpg','brand-chats.svg','brand-workspace.svg','mak-nose.svg','mak-nose-chats.svg']:
 obsolete=(ui/'assets'/name).resolve()
 assert obsolete.is_relative_to(ui.resolve())
 if obsolete.is_file():obsolete.unlink()
(runtime/'README.txt').write_text('Dev Space runtime. Contains Node, terminal dependencies and UI. No user credentials or conversations.\n')
for name in ['LICENSE','THIRD_PARTY_NOTICES.md']:shutil.copy2(root/name,runtime/name)
for candidate in [Path(node).parent/'LICENSE',Path(node).parent.parent/'LICENSE']:
 if candidate.is_file():shutil.copy2(candidate,runtime/'NODE-LICENSE.txt');break
if not (runtime/'NODE-LICENSE.txt').is_file():raise RuntimeError('Node license missing; use npm run desktop:prepare.')
print('Application icons and portable runtime prepared.')
