import test from 'node:test';
import assert from 'node:assert/strict';
import { runReleaseCommand } from '../scripts/release-command.mjs';

test('release commands accept responses larger than the previous 1 MiB buffer', t => {
  const args = ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"];
  let result;
  try { result = runReleaseCommand(process.execPath, args); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Child process launch is restricted'); return; } throw error; }
  assert.equal(result.stdout.length, 2 * 1024 * 1024);
  assert.throws(() => runReleaseCommand(process.execPath, args, { maxBuffer: 1024 * 1024 }), { code: 'ENOBUFS' });
  const failure = runReleaseCommand(process.execPath, ['-e', "process.stderr.write('fixture failure');process.exit(3)"], {allowFailure:true});
  assert.equal(failure.status,3); assert.equal(failure.stderr,'fixture failure');
});
