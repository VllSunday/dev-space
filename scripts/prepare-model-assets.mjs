// Keep the decoder local. GLB viewing must not depend on a CDN connection.
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules/three/examples/jsm/libs/draco/gltf');
const output = path.join(root, process.argv.includes('--dist') ? 'dist/assets/draco' : 'public/assets/draco');
await mkdir(output, { recursive: true });
for (const name of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) await copyFile(path.join(source, name), path.join(output, name));
await copyFile(path.join(root, 'node_modules/three/LICENSE'), path.join(output, 'THREE-LICENSE.txt'));
await copyFile(path.join(root, 'desktop/licenses/DRACO-LICENSE.txt'), path.join(output, 'DRACO-LICENSE.txt'));
await copyFile(path.join(source, '../README.md'), path.join(output, 'DRACO-README.md'));
// copyPublicDir is disabled because workspace/ contains private project files.
if (process.argv.includes('--dist')) await copyFile(path.join(root,'public/assets/dev-space.png'),path.join(root,'dist/assets/dev-space.png'));
