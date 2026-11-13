import { chatTitle } from './titles.mjs';

// The long-chat hand-off is the flow «chat-handoff» from the flow library: the
// chat's agent writes a note, code checks it and opens a new chat that starts by
// reading it. This class only starts that flow for a chat and reports its
// progress in the shape the chat header already shows. One job per chat.
export const HANDOFF_FLOW = 'chat-handoff';

export class Handoffs {
  constructor({ flows, sessions, projectFor, spaceOf, changed }) {
    Object.assign(this, { flows, sessions, projectFor, spaceOf, changed });
    this.jobs = new Map(); this.runs = new Map();
    flows.on('run', run => this.progress(run));
  }
  state(id) { return this.jobs.get(id) || null; }
  update(id, value) { const job = { ...this.jobs.get(id), ...value, at: new Date().toISOString() }; this.jobs.set(id, job); this.changed(id, job); return job; }
  async start(id) {
    const session = this.sessions.get(id);
    if (!session.process) throw new Error('Reconnect this chat before asking for a handoff.');
    if (session.activity === 'working') throw new Error('Wait for the agent to finish its current turn.');
    if (['summarizing', 'opening'].includes(this.jobs.get(id)?.status)) return this.jobs.get(id);
    const job = this.update(id, { status: 'summarizing', error: null, sessionId: null, file: null });
    try {
      const run = await this.flows.launch({ flowId: HANDOFF_FLOW, projectId: await this.projectFor(session), roles: { author: { sessionId: id } }, space: { id: this.spaceOf(id) }, input: { sessionId: id, title: session.name } });
      this.runs.set(run.id, id);
    } catch (error) { return this.update(id, { status: 'failed', error: error.message }); }
    return job;
  }
  progress(run) {
    const id = this.runs.get(run.id);
    if (!id) return;
    const note = run.path.find(entry => entry.step === 'note'), opened = run.path.find(entry => entry.step === 'open');
    if (run.status === 'done') { this.runs.delete(run.id); this.update(id, { status: 'done', sessionId: run.result?.sessionId || null, file: run.result?.file || null }); }
    else if (run.status === 'stopped' || run.status === 'needs-person') { if (run.status === 'stopped') this.runs.delete(run.id); this.update(id, { status: 'failed', error: run.reason || 'The handoff could not be completed.' }); }
    else if (note && !opened) this.update(id, { status: 'opening' });
  }
}

// The first message of the chat that continues the work.
export const continuation = (name, file) => ({
  name: chatTitle(`${name.replace(/ · continued$/, '')} · continued`, name),
  prompt: `Continue the work from the previous chat '${name.replace(/["']/g, '')}'. First read its handoff: \`${file}\`. Then state the next step in one sentence and continue.`,
});
