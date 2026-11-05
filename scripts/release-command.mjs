import { spawnSync } from 'node:child_process';

export function runReleaseCommand(program, args, { cwd, input, allowFailure = false, live = false, maxBuffer = 16 * 1024 * 1024 } = {}) {
  const result = spawnSync(program, args, { cwd, input, encoding: 'utf8', maxBuffer, windowsHide: true, stdio: live ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
  if (result.error) throw Object.assign(Error(`${program}: ${result.error.message}`), { code: result.error.code });
  if (!allowFailure && result.status !== 0) throw Error(result.stderr?.trim() || `${program} failed (${result.status ?? result.signal})`);
  return result;
}
