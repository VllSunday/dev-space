import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initialPromptArgument, terminalCommand } from '../agents.mjs';
import { continuation } from '../handoff.mjs';

test('a first message is one safe argument, placed before Claude\'s variadic --add-dir', async () => {
  const bin = await mkdtemp(path.join(os.tmpdir(), 'mrmak-first-prompt-'));
  for (const name of ['claude', 'codex']) await writeFile(path.join(bin, process.platform === 'win32' ? `${name}.exe` : name), '', { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try {
    const prompt = 'Continue the work. First read its handoff: `C:/handoffs/a b.md`.';
    const claude = terminalCommand('claude', { nativeId: '019a0000-1111-4222-8333-444455556666', initialPrompt: prompt, readDir: bin, effort: 'xhigh' });
    assert.equal(claude.args[0], prompt);
    assert.deepEqual(claude.args.slice(-2), ['--add-dir', bin]);
    const codex = terminalCommand('codex', { initialPrompt: prompt });
    assert.equal(codex.args.at(-1), prompt);
    // Codex runs in the terminal's own process only when it offers --no-daemon.
    assert.ok(!codex.args.includes('--no-daemon') && terminalCommand('codex', { noDaemon: true }).args.includes('--no-daemon'));
    for (const initialPrompt of ['--dangerously-skip-permissions', 'two\nlines', 'say "hi"', 'x'.repeat(4001), '   ']) assert.throws(() => terminalCommand('claude', { initialPrompt }), /first message/);
    assert.throws(() => terminalCommand('claude', { initialPrompt: prompt, resumeId: '019a0000-1111-4222-8333-444455556666' }), /new Codex or Claude/);
    assert.throws(() => terminalCommand('claude', { readDir: 'relative' }), /absolute folder/);
  } finally { process.env.PATH = previous; }
});

// The hand-off itself is the «chat-handoff» flow; flows.test.mjs runs it end to end.
test('the chat that continues the work starts with one safe line that names the handoff file', () => {
  const next = continuation('Dream "Game" Combat · continued', '/repo/inbox/handoffs/a b.md');
  assert.equal(next.name, 'Dream "Game" Combat · continued');
  assert.equal(initialPromptArgument(next.prompt), next.prompt);
  assert.ok(next.prompt.includes('`/repo/inbox/handoffs/a b.md`'));
});
