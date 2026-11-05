import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { spacesOf, spaceOf, workflowStates, priorities, testingSections } from './space-model.mjs';
import { realFile, saveJson, sleep } from './util.mjs';
import { validateCard, cardText, CARD_MAX_BYTES } from './card-schema.mjs';

const execute = promisify(execFile);
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const brief = ({ id, title, description, status, category, created, updated, pinned, steps }) => ({ id, title, description, status, category, created, updated, pinned: !!pinned, steps: (steps || []).map(({ name }, index) => ({ name, index })) });
const invalid = message => Object.assign(new Error(message), { status: 400 });

// Removes <script> and <style> blocks in one pass. A lazy regex up to the closing
// tag rescans the rest of the text for every unclosed opening tag, which lets a
// report stall the service. An unclosed block hides the rest, as it does in a browser.
export function stripCodeBlocks(text) {
  const opening = /<(script|style)\b/gi, closing = { script: /<\/script>/gi, style: /<\/style>/gi };
  let result = '', kept = 0, match;
  while ((match = opening.exec(text))) {
    const tagEnd = text.indexOf('>', opening.lastIndex);
    if (tagEnd < 0) break;
    const close = closing[match[1].toLowerCase()];
    close.lastIndex = tagEnd + 1;
    result += text.slice(kept, match.index) + ' ';
    if (!close.exec(text)) return result;
    kept = opening.lastIndex = close.lastIndex;
  }
  return result + text.slice(kept);
}

// UI requests can only change card metadata, never report paths or contents.
export function metadataPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).some(key => !['status', 'category', 'pinned', 'spaceId', 'priority', 'workflow'].includes(key))) {
    throw invalid('Choose a status, category or pin change.');
  }
  return value;
}

export class Workspace {
  constructor(repo, changed = () => {}) { this.repo = repo; this.file = path.join(repo, 'workspace', 'workspace.json'); this.changed = changed; this.writes = Promise.resolve(); }
  async registry() {
    const registry = JSON.parse(await readFile(this.file, 'utf8'));
    if (!Array.isArray(registry.entities)) throw new Error('Workspace registry is not ready.');
    return registry;
  }
  async list({ query = '', date, status } = {}) {
    const { entities } = await this.registry();
    return entities.filter(item => (!query || `${item.id} ${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase())) && (!date || item.created === date || item.updated === date) && (!status || item.status === status)).map(brief);
  }
  async read(id, step = 0) {
    const entity = (await this.registry()).entities.find(item => item.id === id);
    if (!entity) throw new Error('Workspace card was not found.');
    const result = { ...brief(entity), text: '' };
    const selected = entity.steps?.[step];
    if (!selected) return result;
    const relative = path.join(entity.folder, selected.path.split('?')[0]);
    const { file } = await realFile(path.join(this.repo, 'workspace'), relative);
    if (selected.viewer === 'card' && file.endsWith('.card.json') && (await stat(file)).size <= CARD_MAX_BYTES) return { ...result, text: cardText(validateCard(JSON.parse(await readFile(file, 'utf8')))).slice(0, 12000) };
    if (!/\.(html?|md|txt)$/i.test(file) || (await stat(file)).size > 3 * 1024 * 1024) return { ...result, note: 'The card uses a visual or large report. Open it for the full content.' };
    const text = await readFile(file, 'utf8');
    result.text = stripCodeBlocks(text).replace(/<[^<>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 12000);
    return result;
  }
  async activity(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Use a date in YYYY-MM-DD format.');
    const registry = await this.registry();
    const { stdout = '' } = await execute('git', ['log', `--since=${date}T00:00:00`, `--until=${date}T23:59:59`, '--format=%s', '--name-only', '--max-count=45', '--', 'workspace'], { cwd: this.repo, windowsHide: true, maxBuffer: 128 * 1024 }).catch(() => ({}));
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const paths = lines.filter(line => line.startsWith('workspace/'));
    const cards = registry.entities.filter(item => item.created === date || item.updated === date || paths.some(file => file.startsWith(`workspace/${item.folder}/`))).map(brief);
    return { date, cards, commits: [...new Set(lines.filter(line => !line.startsWith('workspace/')))].slice(0, 15), basis: 'Workspace dates and recorded Git changes; not a complete record of unsaved work.' };
  }
  update(id, patch) {
    const operation = this.writes.catch(() => {}).then(async () => {
      if (patch.status !== undefined && !['active', 'done', 'archived'].includes(patch.status)) throw invalid('Use active, done or archived status.');
      if (patch.pinned !== undefined && typeof patch.pinned !== 'boolean') throw invalid('Pinned must be true or false.');
      if (patch.category !== undefined && (typeof patch.category !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(patch.category))) throw invalid('Use a category with lowercase letters, numbers and hyphens.');
      if (patch.workflow !== undefined && !workflowStates.includes(patch.workflow)) throw invalid('Choose a valid workflow state.');
      if (patch.priority !== undefined && !priorities.includes(patch.priority)) throw invalid('Choose a valid priority.');
      if (!Object.keys(patch).length) throw invalid('Choose a status, category or pin change.');
      for (let attempt = 0; attempt < 6; attempt++) {
        const source = await readFile(this.file, 'utf8');
        const registry = JSON.parse(source);
        const entity = registry.entities.find(item => item.id === id);
        if (!entity) throw Object.assign(new Error('Workspace card was not found.'), { status: 404 });
        if (patch.spaceId !== undefined) {
          const target = spacesOf(registry).find(s => s.id === patch.spaceId);
          if (!target) throw invalid('Space was not found.');
          entity.spaceId = target.id;
          entity.category = target.sections[0]?.id || 'other';
        }
        if (patch.workflow !== undefined) {
          entity.workflow = patch.workflow;
          entity.status = patch.workflow === 'done' ? 'done' : 'active';
        }
        if (patch.priority !== undefined) entity.priority = patch.priority;
        if (patch.status !== undefined) entity.status = patch.status;
        if (patch.status === 'active' && entity.workflow === 'done') entity.workflow = 'backlog';
        if (patch.pinned !== undefined) entity.pinned = patch.pinned;
        if (patch.category !== undefined) entity.category = patch.category;
        entity.updated = localDay();
        // Preserve other agents' latest registry changes instead of saving a stale snapshot.
        if (await readFile(this.file, 'utf8') !== source) continue;
        try { await saveJson(this.file, registry, { beforeReplace: async () => {
          if (await readFile(this.file, 'utf8') !== source) throw Object.assign(new Error('Workspace changed while saving.'), { code: 'ESTALE' });
        } }); }
        catch (error) {
          // Windows indexers/readers can briefly lock atomic replacements. Retry
          // from a fresh registry so another agent's edits are still retained.
          if (!['EPERM', 'EACCES', 'EBUSY', 'ESTALE'].includes(error.code) || attempt === 5) throw error;
          await sleep(40 * (attempt + 1));
          continue;
        }
        this.changed();
        return brief(entity);
      }
      throw new Error('Workspace is being updated by another task. Try the change again.');
    });
    this.writes = operation;
    return operation;
  }
  // All space/section mutations use the same queue as card edits and imports.
  organize(data) {
    const operation = this.writes.catch(() => {}).then(async () => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid('Choose a space action.');
      const name = () => {
        if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80 || /[\x00-\x1f]/.test(data.name)) throw invalid('Enter a name of up to 80 characters.');
        return data.name.trim();
      };
      const id = `s-${randomUUID().slice(0, 8)}`;
      for (let attempt = 0; attempt < 6; attempt++) {
        const source = await readFile(this.file, 'utf8'), registry = JSON.parse(source);
        registry.spaces = spacesOf(registry);
        const space = registry.spaces.find(s => s.id === data.spaceId);
        let result;
        if (data.action === 'create-space') {
          result = { id, name: name(), sections: (data.template === 'testing' ? testingSections : ['General']).map((name, i) => ({ id: `section-${i}`, name })) };
          registry.spaces.push(result);
        } else {
          if (!space) throw invalid('Space was not found.');
          result = space;
          if (data.action === 'rename-space') space.name = name();
          else if (data.action === 'delete-space') {
            if (registry.spaces.length === 1 || registry.entities.some(e => spaceOf(e) === space.id)) throw invalid('Move all cards before deleting this space.');
            registry.spaces = registry.spaces.filter(s => s.id !== space.id);
          } else if (data.action === 'create-section') {
            space.sections.push({ id, name: name() });
          } else {
            const section = space.sections.find(s => s.id === data.sectionId);
            if (!section) throw invalid('Section was not found.');
            if (data.action === 'rename-section') section.name = name();
            else if (data.action === 'move-section') {
              if (!['left', 'right'].includes(data.direction)) throw invalid('Choose left or right.');
              const index = space.sections.indexOf(section), next = index + (data.direction === 'left' ? -1 : 1);
              if (next >= 0 && next < space.sections.length) {
                space.sections.splice(index, 1);
                space.sections.splice(next, 0, section);
              }
            }
            else if (data.action === 'delete-section') {
              if (registry.entities.some(e => spaceOf(e) === space.id && e.category === section.id)) throw invalid('Move all cards before deleting this section.');
              space.sections = space.sections.filter(s => s.id !== section.id);
            } else throw invalid('Choose a space action.');
          }
        }
        try {
          await saveJson(this.file, registry, { beforeReplace: async () => {
            if (await readFile(this.file, 'utf8') !== source) throw Object.assign(new Error('Workspace changed while saving.'), { code: 'ESTALE' });
          } });
          this.changed(); return result;
        } catch (error) {
          if (!['ESTALE', 'EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === 5) throw error;
          await sleep(40 * (attempt + 1));
        }
      }
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
}
