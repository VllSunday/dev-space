import http from 'node:http';
import { DevSpace } from './devspace.mjs';
import { initializeAgentSpaces, agentSpacesSnapshot, changeAgentSpaces, sessionSpaceId } from './agent-spaces.mjs';
import path from 'node:path';
import { readFile, stat, realpath } from 'node:fs/promises';
import { watch } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseEnv } from 'dotenv';
import { Sessions } from './sessions.mjs';
import { Coordinator, openChatArguments } from './coordinator.mjs';
import { Files, serveFile } from './files.mjs';
import { importFile, dragFiles, moveFile, recyclePath, MAX_FILE_BYTES } from './file-transfers.mjs';
import { inventory } from './agents.mjs';
import { Attachments, attachmentText, MAX_IMAGE_BYTES } from './attachments.mjs';
import { ContextLibrary } from './context.mjs';
import { skillLocations } from './skill-locations.mjs';
import { groupLabel, taskTitle } from './titles.mjs';
import { taskEffort } from './effort.mjs';
import { Workspace, localDay, metadataPatch } from './workspace.mjs';
import { CardDocuments } from './card-documents.mjs';
import { QuickActions } from './quick-actions.mjs';
import { defaultVoiceStyle, voiceSession } from './voice-profile.mjs';
import { NativeSettings } from './native-settings.mjs';
import { McpInventory } from './mcp.mjs';
import { body, equalSecret, json, publicError, readJson, realFile, saveJson, secret, sleep } from './util.mjs';
import { ProjectAdapterRegistry } from './project-adapters/registry.mjs';
import { KnowledgeManager, MarkdownKnowledgeProvider } from './knowledge/providers.mjs';
import { IntegrationManager } from './integrations/manager.mjs';
import { MobileDictation } from './mobile-dictation.mjs';
import { MobileGateway } from './mobile.mjs';
import { ConversationTranscripts } from './mobile-transcript.mjs';
import { ConversationMedia } from './conversation-media.mjs';
import { projectKey, recentProjects } from './recent-projects.mjs';
import { answerPrompt, readPrompt } from './terminal-prompt.mjs';
import { rewindToMessage } from './message-edit.mjs';
import { LocalReadAloud } from './local-read-aloud.mjs';
import { Handoffs, continuation } from './handoff.mjs';
import { Plugins } from './plugins/registry.mjs';
import { Operations } from './plugins/operations.mjs';
import { roles as connectionRoles } from './plugins/roles.mjs';
import { Flows } from './flows/engine.mjs';
import { createCommands } from './commands.mjs';
import { AgentApi } from './agent-api.mjs';
import { boardPresets } from './boards.mjs';
import { taskThing } from './things.mjs';
import { chatCommands } from './chat-commands.mjs';
import { isThemePreference } from './appearance.mjs';
import { validateLayout } from './pane-layout.mjs';
import { CustomFonts, defaultDisplay, displaySettings } from './custom-fonts.mjs';
import { configureWhisper, localWhisperSettings } from './local-whisper-settings.mjs';

const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)); });

export async function createService({ repo, uiDir, stateDir, token = secret(), native = () => {}, restoreSessions = false, mcpOptions, mobileOptions, localWhisperCheck, pluginFetch, allowFileGit = false }) {
  repo = await realpath(repo);
  stateDir ||= path.join(repo, '.devspace');
  const fonts = new CustomFonts(stateDir);
  const dictation = mobileOptions?.dictation || new MobileDictation(repo);
  const files = new Files(repo);
  const attachments = new Attachments(repo);
  const library = new ContextLibrary(repo);
  const knowledgeSources = await readJson(path.join(stateDir, 'knowledge-sources.json'), []);
  const knowledgeProviders = (Array.isArray(knowledgeSources) ? knowledgeSources : []).filter(item => typeof item?.root === 'string').map(item => new MarkdownKnowledgeProvider(item.root, { id: item.id, label: item.label }));
  const knowledge = new KnowledgeManager(library, knowledgeProviders);
  const projects = new ProjectAdapterRegistry();
  const integrations = await new IntegrationManager(stateDir).init();
  const mcp = new McpInventory(repo, mcpOptions);
  const sessions = await new Sessions(repo, stateDir).init();
  const transcripts = new ConversationTranscripts();
  const conversationMedia = new ConversationMedia();
  const readAloud = mobileOptions?.readAloud || new LocalReadAloud(repo);
  const environment = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
  const settingsPath = path.join(stateDir, 'settings.json');
  const savedSettings = await readJson(settingsPath, null);
  let settings = { language: 'ru', defaultAgent: 'codex', defaultBypass: false, coordinatorModel: environment.MRMAK_COORDINATOR_MODEL?.trim() || null, terminalFontSize: 13, terminalAppearance: 'original', workspaceTheme: 'dark', coordinatorEffort: 'medium', voiceName: 'cedar', voiceStyle: defaultVoiceStyle, handoffAfter: 40, groupTabsByProject: false, systemEvents: 'compact', ...savedSettings };
  if (!['ru', 'en'].includes(settings.language)) settings.language = 'ru';
  try { settings.display = displaySettings(settings.display || defaultDisplay); } catch { settings.display = { ...defaultDisplay }; }
  native({ type: 'language', language: settings.language });
  if (await dictation.initializeProvider?.(settings, savedSettings !== null)) await saveJson(settingsPath, settings);
  dictation.providerChoice = () => settings.transcribeProvider || null;
  const chooseDictation = async provider => {
    if (!['local', 'openai', 'openrouter', 'off'].includes(provider)) throw Object.assign(new Error('Choose a supported speech-to-text provider.'), { status: 400 });
    settings.transcribeProvider = provider; await saveSettings();
    const info = await dictation.status();
    broadcast('settings', { settings }); broadcast('dictation', { dictation: info });
    mobile?.broadcast({ type: 'dictation', dictation: info });
    return info;
  };
  const projectList = () => recentProjects({ repo, sessions: sessions.list(), pinned: settings.pinnedProjects || [] });
  let selectedId = sessions.active().some(item => item.id === settings.selectedId) ? settings.selectedId : sessions.active()[0]?.id || null;
  let workspaceRoute = settings.workspaceRoute || null;
  let settingsTimer;
  let settingsSave = Promise.resolve();
  const saveSettings = () => { settingsSave = settingsSave.catch(() => {}).then(() => saveJson(settingsPath, settings)); return settingsSave; };
  const scheduleSettings = () => { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => saveSettings().catch(() => {}), 500); };
  const transcriptPath = path.join(stateDir, 'voice-transcripts.json');
  let voiceHistory = await readJson(transcriptPath, []);
  let transcriptSave = Promise.resolve();
  let voiceOwner = null;
  let closing = false;
  let whisperSetupBusy = false;
  const clients = new Set();
  let mobile;
  const notices = [];
  const send = (ws, type, value) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...value })); };
  const broadcast = (type, value) => { for (const ws of clients) send(ws, type, value); };
  const nativeSettings = new NativeSettings(native, value => broadcast('native-settings', value));
  const show = (window, extra = {}) => { native({ type: 'window', action: 'show', window }); broadcast('navigate', { window, ...extra }); };
  const focus = id => { sessions.get(id); selectedId = id; settings.selectedId = id; scheduleSettings(); show('chats', { sessionId: id }); return { selectedId: id }; };
  const registry = async () => readJson(path.join(repo, 'workspace', 'workspace.json'), { entities: [] });
  const workspace = new Workspace(repo, () => broadcast('workspace-changed', {}));
  const devspace = await new DevSpace(repo, () => broadcast('devspace-changed', {})).init();
  initializeAgentSpaces(settings,repo,sessions.list());await saveSettings();
  let agentSpacesQueue=Promise.resolve();
  const bindAgentSpace=async(id,spaceId)=>{settings.agentSessionSpaces={...settings.agentSessionSpaces,[id]:spaceId};await saveSettings();broadcast('settings',{settings})};
  const cards = new CardDocuments(workspace);
  const history = query => sessions.list().filter(item => !query || `${item.name} ${item.agent} ${item.cwd} ${item.preview || ''}`.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const closeChat = async id => {
    await sessions.remove(id);
    if (selectedId === id) { selectedId = sessions.active()[0]?.id || null; settings.selectedId = selectedId; scheduleSettings(); broadcast('selection', { selectedId }); }
    return { closed: true, savedInHistory: true };
  };
  // ── Plugins, the command pool and flows ──
  const plugins = await new Plugins({ repo, allowFileGit, changed: () => broadcast('plugins-changed', {}) }).init();
  const operations = await new Operations({ plugins, repo, stateDir, fetch: pluginFetch, native: {
    'tasks.list': async (_, context) => ({ items: (await devspace.read()).tasks.filter(task => task.projectId === context.projectId).map(taskThing) }),
    'tasks.setStatus': async ({ id, status }, context) => {
      if (!(await devspace.read()).tasks.some(task => task.id === id && (!context.projectId || task.projectId === context.projectId))) throw Object.assign(new Error('Задача не найдена в проекте.'), { status: 404 });
      await devspace.mutate({ action: 'update-task', id, status: { todo: 'todo', doing: 'working', done: 'done' }[status] }, { latest: true });
      return { ok: true, result: status };
    },
  } }).init();
  const quiet = async (id, limit = 30000) => { for (const until = Date.now() + limit; Date.now() < until;) { const session = sessions.get(id); if (session.status === 'running' && Date.now() - Date.parse(session.lastOutputAt || session.createdAt) > 1500) return; await sleep(300); } };
  // Delivers one line to an agent's terminal and submits it. A person typing in
  // that terminal at the same moment is not interrupted: the line waits.
  const sendLine = async (id, text) => { for (let attempt = 0; ; attempt++) { try { return sessions.input(id, text, { coordinator: true, submit: true }); } catch (error) { if (attempt >= 4 || !/typing/.test(error.message)) throw error; await sleep(2600); } } };
  const openAgent = async ({ agent, name, cwd, spaceId, line, readDir }) => {
    const first = line && ['codex', 'claude'].includes(agent) && line.length <= 4000 && !/["\x00-\x1f\x7f]/.test(line);
    const session = await sessions.create({ agent, cwd, name, bypass: settings.defaultBypass === true, ...(first ? { initialPrompt: line, readDir } : {}) });
    await bindAgentSpace(session.id, settings.agentSpaces.some(space => space.id === spaceId) ? spaceId : settings.selectedAgentSpaceId);
    if (line && !first) quiet(session.id).then(() => sendLine(session.id, line)).catch(error => broadcast('service-error', { error: publicError(error) }));
    return session.id;
  };
  let flows;
  const commands = createCommands({
    repo, sessions, devspace, plugins, operations, flows: () => flows, settings: () => settings, openAgent, send: sendLine,
    spaceOf: id => id ? sessionSpaceId(settings, id) : settings.selectedAgentSpaceId, broadcast, changed: () => broadcast('devspace-changed', {}),
    continueChat: async (sessionId, file) => {
      const source = sessions.get(sessionId), next = continuation(source.name, file);
      const id = await openAgent({ agent: source.agent, cwd: source.cwd, name: next.name, spaceId: sessionSpaceId(settings, sessionId), line: next.prompt, readDir: path.dirname(file) });
      focus(id);
      return { sessionId: id, file, summary: 'Открыт новый чат с заметкой.' };
    },
    // After a plugin made by words is accepted, it is put where it was asked for.
    placePlugin: async (plugin, input) => {
      const state = await devspace.read(), board = state.boards.find(item => item.id === input.boardId);
      if (!board) return;
      const view = plugin.views.find(item => item.level === 'zone'), look = plugin.boards[0];
      if (look) await devspace.mutate({ action: 'board-update', boardId: board.id, kind: `${plugin.id}/${look.id}` }, { latest: true });
      if (!view) return;
      if (board.zones.some(zone => zone.id === input.zoneId)) await devspace.mutate({ action: 'zone-update', boardId: board.id, zoneId: input.zoneId, view: `${plugin.id}/${view.id}` }, { latest: true });
      else await devspace.mutate({ action: 'zone-create', boardId: board.id, name: view.title, view: `${plugin.id}/${view.id}`, source: view.accepts.includes('task') ? { kind: 'tasks' } : view.accepts.includes('page') ? { kind: 'pages' } : { kind: 'topic', topicId: 'all' } }, { latest: true });
    },
  });
  const agentApi = await new AgentApi({ stateDir, sessions, commands }).init();
  flows = await new Flows({ repo, stateDir, plugins, operations, host: {
    command: (name, args, context) => commands.run(name, args, context),
    project: async id => { const project = (await devspace.read()).projects.find(item => item.id === id); if (!project) throw Object.assign(new Error('Проект не найден.'), { status: 404 }); return project; },
    session: id => sessions.items.get(id) || null,
    agentAvailable: agent => inventory().some(item => item.id === agent && item.available && item.id !== 'shell'),
    agentChoices: () => inventory().filter(item => item.available && item.id !== 'shell').map(item => item.id),
    currentSpace: () => settings.selectedAgentSpaceId,
    createSpace: async (name, cwd) => { await changeAgentSpaces(settings, { action: 'create', name, cwd }, sessions.list()); const space = settings.agentSpaces.at(-1); settings.selectedAgentSpaceId = space.id; await saveSettings(); broadcast('settings', { settings }); return space.id; },
    openAgent, send: sendLine,
  } }).init();
  flows.on('run', run => broadcast('flow-run', { run }));
  flows.on('library', () => broadcast('flows-changed', {}));
  const completions = new Map();
  sessions.on('session', session => { const previous = completions.get(session.id); completions.set(session.id, { completionVersion: session.completionVersion }); flows.sessionChanged(session, previous); });
  const handoffs = new Handoffs({ flows, sessions, spaceOf: id => sessionSpaceId(settings, id), changed: (id, handoff) => broadcast('handoff', { id, handoff }),
    projectFor: async session => { const state = await devspace.read(); return (state.projects.find(project => path.resolve(project.path) === path.resolve(session.cwd)) || state.projects.find(project => project.id === settings.spaceLayout?.projectId) || state.projects[0]).id; } });
  const attach = async (id, paths, coordinator = false) => {
    const session = sessions.get(id);
    const verified = await attachments.paths(paths);
    sessions.input(id, attachmentText(verified, session.agent), { coordinator, submit: false });
    return { attached: verified, submitted: false };
  };
  const coordinator = await new Coordinator({
    repo, stateDir, orientation: () => library.orientation(), settings: () => settings,
    context: () => ({ repo, localDate: localDay(), selectedId, workspaceRoute, chats: sessions.active(), recentNotices: notices.slice(-5), recentRequests: [...coordinator.operations.values(), ...quick.operations.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-6).map(({ text, result, status }) => ({ text, result, status })) }),
    execute: async (name, args, operationId, requestText) => {
      const latestRequest = requestText || coordinator.operations.get(operationId)?.text || '';
      if (['reopen_chat', 'send_to_chat', 'attach_files'].includes(name)) {
        const target = sessions.get(args.id);
        if (target.agent === 'shell') throw new Error('Use the local shell directly. Dev Space can send tasks only to agent chats.');
        if (target.bypass && settings.defaultBypass !== true) throw new Error('This chat uses bypass permissions. Send the task directly, or enable bypass yourself in Settings before using Dev Space to control it.');
      }
      switch (name) {
        case 'list_chats': return sessions.active();
        case 'search_history': return history(args.query || '').slice(0, 70);
        case 'list_projects': { const query = String(args.query || '').toLowerCase(); return (await projectList()).filter(item => `${item.name} ${item.path}`.toLowerCase().includes(query)).slice(0, 40); }
        case 'reopen_chat': { const session = await sessions.resume(args.id); focus(session.id); return session; }
        case 'close_chat': return closeChat(args.id);
        case 'pin_chat': return sessions.pin(args.id, args.pinned);
        case 'open_chat': {
          args = openChatArguments(args);
          if (args.bypass === true && settings.defaultBypass !== true) throw new Error('To enable bypass, choose it yourself in New chat or Settings. Dev Space cannot raise the selected permission level.');
          const spaceId=settings.selectedAgentSpaceId;
          const session = await sessions.create({ agent: args.agent, cwd: args.cwd, name: taskTitle(args.name), effort: taskEffort(latestRequest, args.effort), bypass: args.bypass === false ? false : settings.defaultBypass === true });
          await bindAgentSpace(session.id,spaceId);
          focus(session.id); return session;
        }
        case 'read_chat': return sessions.read(args.id);
        case 'send_to_chat': return sessions.input(args.id, args.text, { coordinator: true, submit: true });
        case 'attach_files': return attach(args.id, args.paths, true);
        case 'focus_chat': return focus(args.id);
        case 'rename_chat': return sessions.rename(args.id, args.name);
        case 'interrupt_chat': sessions.input(args.id, '\x03'); return { delivered: 'Ctrl+C', sessionId: args.id };
        case 'list_workspace': return workspace.list(args);
        case 'read_workspace': return workspace.read(args.entityId, args.step);
        case 'workspace_activity': return workspace.activity(args.date);
        case 'update_workspace': return workspace.update(args.entityId, args);
        case 'show_workspace': {
          if (args.entityId && !(await registry()).entities.some(item => item.id === args.entityId)) throw new Error('Workspace report does not exist');
          workspaceRoute = args.entityId ? `#/${encodeURIComponent(args.entityId)}${Number.isInteger(args.step) ? '/' + args.step : ''}` : null;
          settings.workspaceRoute = workspaceRoute; scheduleSettings();
          show('workspace', { route: workspaceRoute }); return { shown: true, route: workspaceRoute };
        }
        case 'preview_file': { const preview = await files.preview(args.path); show('workspace', { preview }); return { shown: preview.path }; }
        case 'list_files': return files.list(args.path || repo, 'all', args.query || '');
        case 'search_context': return knowledge.searchText(args.query);
        case 'read_context': return knowledge.read(args.path, args.offset);
        case 'list_skills': return knowledge.skills(args.query || '');
        case 'list_mcp': return mcp.list();
        case 'get_app_settings': return { voice: settings.voiceName, style: settings.voiceStyle, model: coordinator.model || 'Codex default', effort: settings.coordinatorEffort, billing: 'Codex subscription for the coordinator; OpenAI API for voice' };
        case 'update_voice': {
          if (typeof args.style === 'string' && args.style.trim()) settings.voiceStyle = args.style.trim().slice(0, 1800);
          if (['cedar', 'marin'].includes(args.voice)) settings.voiceName = args.voice;
          await saveSettings(); broadcast('settings', { settings });
          return { saved: true, voice: settings.voiceName, style: settings.voiceStyle, applies: 'Next voice connection. Reconnect to apply the saved voice and personality.' };
        }
        default: throw new Error('Unknown coordinator tool');
      }
    },
  }).init();
  const quick = await new QuickActions({ stateDir, workspace, context: () => ({ chats: sessions.active(), route: workspaceRoute }), execute: (...args) => coordinator.execute(...args), completed: operation => broadcast('coordinator-result', { operation }) }).init();
  const askMak = async data => {
    if (coordinator.operationPromises.has(data.id) || coordinator.operations.has(data.id)) return coordinator.ask(data);
    const images = await attachments.coordinatorImages(data.images);
    if (images.length) return coordinator.ask({ ...data, images });
    return await quick.ask(data) || coordinator.ask({ ...data, images });
  };
  coordinator.on('state', state => broadcast('coordinator-state', { state }));
  coordinator.on('result', operation => broadcast('coordinator-result', { operation }));
  coordinator.on('error-detail', error => broadcast('service-error', { error }));
  sessions.on('session', session => { broadcast('session', { session }); integrations.publish('session', { event: session.status, session }).catch(() => {}); });
  sessions.on('screen-cleared', ({ id }) => broadcast('screen-cleared', { id }));
  sessions.on('service-error', error => broadcast('service-error', { error: publicError(error) }));
  sessions.on('output', output => {
    for (const ws of clients) {
      if (!ws.subscriptions.has(output.id)) continue;
      if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'Reconnect to restore the terminal screen'); continue; }
      send(ws, 'output', output);
    }
  });
  sessions.on('notice', notice => { notices.push(notice); if (notices.length > 100) notices.shift(); broadcast('notice', { notice }); if (notice.kind === 'turn-completed' || notice.kind === 'exit') integrations.publish('completion', notice).catch(() => {}); });

  const contentServer = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(files.origin).host || !['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('Not allowed'), { status: 403 });
      // A plugin view with its own code. It is served from this separate origin
      // with a sandbox policy: no access to the app, no disk, and network only to
      // the hosts the plugin declared.
      const pluginView = /^\/plugin-view\/([\w-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(new URL(request.url, files.origin).pathname);
      if (pluginView) {
        if (!equalSecret(pluginView[1], files.repoGrant)) throw Object.assign(new Error('Not allowed'), { status: 403 });
        const { html, hosts } = await plugins.viewCode(pluginView[2], pluginView[3]);
        const page = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark"><style>html{color-scheme:dark;background:transparent}</style><script>addEventListener('message',e=>{if(e.data&&e.data.type==='devspace:data'&&e.data.theme)for(const k in e.data.theme)document.documentElement.style.setProperty(k,e.data.theme[k])})</script>${html}`;
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src ${hosts.length ? hosts.map(host => 'https://' + host).join(' ') : "'none'"}; form-action 'none'; base-uri 'none'` });
        response.end(request.method === 'HEAD' ? undefined : page); return;
      }
      await files.content(request, response, new URL(request.url, files.origin));
    } catch (error) { if (!response.headersSent) json(response, error.status || 404, { error: publicError(error) }); }
  });
  files.origin = await listen(contentServer);

  function authorize(request) {
    if (request.headers.host !== new URL(origin).host) throw Object.assign(new Error('Unexpected host'), { status: 403 });
    if (request.headers.origin && request.headers.origin !== origin) throw Object.assign(new Error('Unexpected origin'), { status: 403 });
    if (!equalSecret(request.headers.authorization, `Bearer ${token}`)) throw Object.assign(new Error('Open Dev Space from its desktop launcher'), { status: 401 });
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (request.headers.host !== new URL(origin).host) throw Object.assign(new Error('Unexpected host'), { status: 403 });
      if (url.pathname === '/health') return json(response, 200, { service: 'mrmak', version: '0.6.0' });
      // An <img> cannot send the bearer token. Its unguessable, short-lived grant
      // is issued only through an authorized messages request for this chat.
      const media = /^\/media\/([a-f0-9-]{36})\/([a-zA-Z0-9_-]{43})$/.exec(url.pathname);
      if (media && ['GET', 'HEAD'].includes(request.method)) return await conversationMedia.serve(request, response, media[1], media[2], 'desktop', url.searchParams.get('download') === '1');
      // The `devspace` command. It carries a per-terminal token and reaches only
      // the command pool, never the rest of the API.
      if (url.pathname === '/agent/command' && request.method === 'POST') {
        if (request.headers.origin) throw Object.assign(new Error('Not allowed'), { status: 403 });
        return json(response, 200, { result: await agentApi.handle(request.headers['x-devspace-token'], await body(request, 256 * 1024)) });
      }
      if (url.pathname.startsWith('/api/')) {
        authorize(request);
        const method = request.method;
        if (method === 'POST' && url.pathname === '/api/appearance/fonts') {
          const font = await fonts.upload(request, decodeURIComponent(request.headers['x-file-name'] || 'font'));
          broadcast('appearance-fonts', {}); return json(response, 201, font);
        }
        if (method === 'GET' && url.pathname === '/api/appearance/fonts') return json(response, 200, await fonts.list());
        const fontRoute = /^\/api\/appearance\/fonts\/([a-f\d-]{36})$/.exec(url.pathname);
        if (method === 'GET' && fontRoute) {
          const bytes = await fonts.bytes(fontRoute[1]);
          response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); response.end(bytes); return;
        }
        if (method === 'POST' && url.pathname === '/api/devspace/files') return json(response, 201, await devspace.upload(request, decodeURIComponent(request.headers['x-file-name'] || 'file')));
        if (method === 'GET' && url.pathname === '/api/devspace/drafts') return json(response, 200, await devspace.readDraft(url.searchParams.get('key')||''));
        if (method === 'GET' && url.pathname === '/api/devspace') return json(response, 200, await devspace.read());
        if (method === 'GET' && url.pathname === '/api/devspace/proposals') return json(response, 200, await devspace.proposals());
        const cardImage = /^\/api\/workspace\/cards\/([^/]+)\/(\d+)\/images$/.exec(url.pathname);
        if (method === 'POST' && cardImage) return json(response, 201, await cards.image(decodeURIComponent(cardImage[1]), Number(cardImage[2]), request, url.searchParams.get('name')));
        if (method === 'POST' && url.pathname === '/api/files/import') {
          if (Number(request.headers['content-length']) > MAX_FILE_BYTES) throw Object.assign(new Error('Choose files of 1 GB or less.'), { status: 413 });
          const result = await importFile(request, url.searchParams.get('folder'), url.searchParams.get('name'));
          await integrations.publish('artifact', { kind: 'imported', ...result });
          broadcast('workspace-changed', {});
          return json(response, 201, result);
        }
        if (method === 'POST' && url.pathname === '/api/attachments') {
          const chunks = []; let length = 0;
          for await (const chunk of request) { length += chunk.length; if (length > MAX_IMAGE_BYTES) throw Object.assign(new Error('Choose an image smaller than 25 MB.'), { status: 413 }); chunks.push(chunk); }
          return json(response, 201, await attachments.save(Buffer.concat(chunks), decodeURIComponent(request.headers['x-file-name'] || 'Screenshot')));
        }
        if (method === 'GET' && url.pathname === '/api/dictation') return json(response, 200, await dictation.status());
        if (method === 'GET' && url.pathname === '/api/dictation/local') return json(response, 200, await localWhisperSettings(repo));
        if (method === 'POST' && url.pathname === '/api/transcribe') return json(response, 200, await dictation.transcribe(request, 'desktop', () => !closing));
        const data = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await body(request, url.pathname.startsWith('/api/devspace') ? 4 * 1024 * 1024 : url.pathname === '/api/files/markdown' ? 12 * 1024 * 1024 : url.pathname.startsWith('/api/workspace/cards') ? 2 * 1024 * 1024 : 256 * 1024) : {};
        if (method === 'DELETE' && fontRoute) {
          const removed = await fonts.remove(fontRoute[1]);
          for (const key of ['interfaceFont', 'terminalFont']) if (settings.display[key] === removed.family) settings.display[key] = defaultDisplay[key];
          await saveSettings(); broadcast('settings', { settings }); broadcast('appearance-fonts', {}); return json(response, 200, await fonts.list());
        }
        if(method==='GET'&&url.pathname==='/api/agent-spaces')return json(response,200,agentSpacesSnapshot(settings));
        if(method==='POST'&&url.pathname==='/api/agent-spaces'){
          const operation=agentSpacesQueue.catch(()=>{}).then(async()=>{const result=await changeAgentSpaces(settings,data,sessions.list(),{closeSessions:async ids=>{for(const id of ids)await closeChat(id)}});await saveSettings();broadcast('settings',{settings});return result});agentSpacesQueue=operation;return json(response,200,await operation);
        }
        if(method==='POST'&&url.pathname==='/api/agent-space-layout'){
          if(!settings.agentSpaces.some(s=>s.id===data.spaceId))throw Object.assign(Error('Agent space not found.'),{status:404});
          let layout;try{layout=validateLayout(data.layout)}catch(error){throw Object.assign(error,{status:400})}
          settings.agentSpaceLayouts={...settings.agentSpaceLayouts,[data.spaceId]:layout};await saveSettings();return json(response,200,layout);
        }
        if (method === 'POST' && url.pathname === '/api/agent-layout') {
          if (!(await devspace.read()).projects.some(project => project.id === data.projectId)) throw Object.assign(Error('Проект не найден.'), { status: 400 });
          let layout; try { layout = validateLayout(data.layout); } catch (error) { throw Object.assign(error, { status: 400 }); }
          settings.agentLayouts = { ...(settings.agentLayouts || {}), [data.projectId]: layout };
          await saveSettings(); return json(response, 200, layout);
        }
        if (method === 'PUT' && url.pathname === '/api/devspace/drafts') return json(response, 200, await devspace.saveDraft(data));
        if (method === 'POST' && url.pathname === '/api/devspace/files/import') return json(response,201,await devspace.importFile(data.path));
        if (method === 'POST' && url.pathname === '/api/devspace') return json(response, 200, await devspace.mutate(data));
        // ── Boards, plugins and connections ──
        if (method === 'GET' && url.pathname === '/api/board-presets') return json(response, 200, boardPresets);
        if (method === 'GET' && url.pathname === '/api/plugins') return json(response, 200, { plugins: plugins.list(), catalog: plugins.catalog(), drafts: await plugins.drafts(), connections: operations.list(), roles: Object.values(connectionRoles), viewBase: `${files.origin}/plugin-view/${files.repoGrant}` });
        if (method === 'POST' && url.pathname === '/api/plugins/inspect') return json(response, 200, await plugins.inspect(data.source));
        if (method === 'POST' && url.pathname === '/api/plugins/install') return json(response, 200, await plugins.install(data.ticket));
        if (method === 'POST' && url.pathname === '/api/plugins/uninstall') return json(response, 200, await plugins.uninstall(data.id));
        if (method === 'POST' && url.pathname === '/api/plugins/drafts/discard') return json(response, 200, await plugins.discardDraft(data.id));
        if (method === 'POST' && url.pathname === '/api/connections') { const result = await operations.configure(data.id, { settings: data.settings, secret: data.secret }); broadcast('plugins-changed', {}); return json(response, 200, result); }
        if (method === 'GET' && url.pathname === '/api/connections/items') { const connection = operations.find(url.searchParams.get('id')).connection; return json(response, 200, await operations.call(url.searchParams.get('id'), connection.plays?.operations.list || 'list', {}, { projectId: url.searchParams.get('projectId') })); }
        // A view asks to change a thing that lives in a connection. Only the role's
        // status change is offered to views.
        if (method === 'POST' && url.pathname === '/api/connections/status') { const result = await operations.callRole(data.id, operations.find(data.id).connection.plays?.role, 'setStatus', { id: String(data.itemId), status: data.status }, { projectId: data.projectId }); broadcast('devspace-changed', {}); return json(response, 200, result); }
        // ── Flows ──
        if (method === 'GET' && url.pathname === '/api/flows') return json(response, 200, { flows: await flows.library(), drafts: await flows.drafts(), blocks: flows.describeBlocks(), runs: flows.list(), reference: await commands.run('help', {}, {}), commands: commands.list() });
        if (method === 'POST' && url.pathname === '/api/flows/validate') { let raw = null; try { raw = JSON.parse(data.text); } catch (error) { return json(response, 200, { ok: false, problems: [{ step: null, text: 'Текст не читается как JSON: ' + error.message }], flow: null, order: [] }); } const entry = flows.entry(raw?.id || 'draft', raw, 'draft', ''); return json(response, 200, { ok: entry.ok, problems: entry.problems, flow: entry.flow, order: entry.order }); }
        if (method === 'PUT' && url.pathname === '/api/flows') return json(response, 200, await flows.save(data.id, data.text));
        if (method === 'DELETE' && url.pathname === '/api/flows') return json(response, 200, await flows.remove(data.id));
        if (method === 'POST' && url.pathname === '/api/flows/drafts') return json(response, 200, data.action === 'accept' ? await flows.acceptDraft(data.id) : await flows.discardDraft(data.id));
        if (method === 'POST' && url.pathname === '/api/flows/launch') return json(response, 201, await flows.launch({ flowId: data.flowId, projectId: data.projectId, roles: data.roles, needs: data.needs, space: data.space || {}, input: data.input || {} }));
        if (method === 'GET' && url.pathname === '/api/flows/decisions') return json(response, 200, { decisions: await flows.decisions(url.searchParams.get('run') || '') });
        if (method === 'POST' && url.pathname === '/api/flows/decide') return json(response, 200, await flows.decide(data.runId, data.output, data.note));
        if (method === 'POST' && url.pathname === '/api/flows/resolve') return json(response, 200, await flows.resolve(data.runId, data.action));
        if (method === 'POST' && url.pathname === '/api/dictation') return json(response, 200, await chooseDictation(data.provider));
        if (method === 'POST' && url.pathname === '/api/dictation/local') {
          if (whisperSetupBusy || dictation.controllers?.size) throw Object.assign(Error('Дождитесь завершения текущей проверки или распознавания.'), { status: 429 });
          whisperSetupBusy = true;
          const controller = new AbortController(), cancel = () => controller.abort(), providerBefore = settings.transcribeProvider;
          response.once('close', cancel);
          try {
            const result = await configureWhisper(repo, data, { runner: localWhisperCheck, signal: controller.signal });
            if (settings.transcribeProvider === providerBefore) await chooseDictation('local');
            return json(response, 200, result);
          } finally { whisperSetupBusy = false; response.off('close', cancel); }
        }
        if (method === 'GET' && url.pathname === '/api/mobile') return json(response, 200, mobile.status());
        if (method === 'GET' && url.pathname === '/api/mobile/check') return json(response, 200, await mobile.transport.probe());
        if (method === 'POST' && url.pathname === '/api/mobile/enable') return json(response, 200, await mobile.enable());
        if (method === 'POST' && url.pathname === '/api/mobile/disable') return json(response, 200, await mobile.disable());
        if (method === 'POST' && url.pathname === '/api/mobile/pair') return json(response, 200, await mobile.newPairing());
        if (method === 'POST' && url.pathname === '/api/mobile/approve') return json(response, 200, await mobile.approve(data.id));
        if (method === 'POST' && url.pathname === '/api/mobile/revoke') return json(response, 200, await mobile.revoke(data.id));
        if (method === 'GET' && url.pathname === '/api/bootstrap') {
          const keys = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
          return json(response, 200, { repo, contentBase: `${files.origin}/view/${files.repoGrant}`, agents: inventory(), sessions: sessions.list(), settings, selectedId, notices, coordinator: coordinator.state, voice: { configured: !!(keys.OPENAI_API_KEY || keys.OPENAI_KEY || process.env.OPENAI_API_KEY), owner: voiceOwner }, voiceHistory, operations: [...coordinator.operations.values(), ...quick.operations.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-30) });
        }
        if (method === 'GET' && url.pathname === '/api/workspace') return json(response, 200, await registry());
        if (method === 'POST' && url.pathname === '/api/workspace/spaces') return json(response, 200, await workspace.organize(data));
        if (method === 'POST' && url.pathname === '/api/workspace/cards') return json(response, 201, await cards.create(data));
        const cardDocument = /^\/api\/workspace\/cards\/([^/]+)\/(\d+)$/.exec(url.pathname);
        if (cardDocument && method === 'GET') return json(response, 200, await cards.read(decodeURIComponent(cardDocument[1]), Number(cardDocument[2])));
        if (cardDocument && method === 'PUT') return json(response, 200, await cards.save(decodeURIComponent(cardDocument[1]), Number(cardDocument[2]), data));
        const cardMetadata = url.pathname.match(/^\/api\/workspace\/entities\/([^/]+)$/);
        if (method === 'PATCH' && cardMetadata) return json(response, 200, await workspace.update(decodeURIComponent(cardMetadata[1]), metadataPatch(data)));
        if (method === 'GET' && url.pathname === '/api/projects') {
          const matches = await projects.detect(url.searchParams.get('path') || repo);
          return json(response, 200, { matches, adapters: projects.adapters.map(item => ({ id: item.id, label: item.label })) });
        }
        if (method === 'GET' && url.pathname === '/api/projects/capabilities') {
          const matches = await projects.detect(url.searchParams.get('path') || repo);
          const selected = matches.find(item => item.adapterId === (url.searchParams.get('adapter') || matches[0]?.adapterId));
          return json(response, 200, selected ? await projects.capabilities(selected) : { matches: [] });
        }
        if (method === 'GET' && url.pathname === '/api/knowledge/providers') return json(response, 200, knowledge.list());
        if (method === 'GET' && url.pathname === '/api/knowledge/search') return json(response, 200, await knowledge.search(url.searchParams.get('q') || '', url.searchParams.get('provider')));
        if (method === 'GET' && url.pathname === '/api/knowledge/document') return json(response, 200, await knowledge.retrieve(url.searchParams.get('provider') || '', url.searchParams.get('ref') || '', url.searchParams.get('offset')));
        if (method === 'GET' && url.pathname === '/api/integrations') return json(response, 200, { providers: integrations.list(), bindings: integrations.bindings.map(({ providerId, externalId, workspaceId, boundAt }) => ({ providerId, externalId, workspaceId, boundAt })) });
        if (method === 'POST' && url.pathname === '/api/integrations/bind') return json(response, 200, await integrations.bind(data));
        if (method === 'GET' && url.pathname === '/api/native/settings') return json(response, 200, nativeSettings.value);
        if (method === 'GET' && url.pathname === '/api/mcp') return json(response, 200, await mcp.list());
        if (method === 'POST' && url.pathname === '/api/mcp/check') return json(response, 200, await mcp.check(data.id));
        if (method === 'POST' && url.pathname === '/api/native/settings') return json(response, 200, await nativeSettings.set(data.winKey));
        if (method === 'GET' && url.pathname === '/api/recent-projects') return json(response, 200, await projectList());
        if (method === 'POST' && url.pathname === '/api/recent-projects/pin') {
          const project = (await projectList()).find(item => typeof data.path === 'string' && projectKey(item.path) === projectKey(data.path));
          if (!project || typeof data.pinned !== 'boolean') throw new Error('Choose a project from the list.');
          const others = (settings.pinnedProjects || []).filter(item => projectKey(item) !== projectKey(project.path));
          settings.pinnedProjects = data.pinned ? [...others, project.path].slice(-30) : others;
          await saveSettings(); broadcast('settings', { settings });
          return json(response, 200, await projectList());
        }
        if (method === 'GET' && url.pathname === '/api/read-aloud') return json(response, 200, await readAloud.status());
        if (method === 'POST' && url.pathname === '/api/preview/show') {
          // A link in a chat may be relative to that chat's working folder.
          const base = typeof data.sessionId === 'string' ? sessions.get(data.sessionId).cwd : repo;
          if (typeof data.path !== 'string' || !data.path.trim() || /[\x00-\x1f]/.test(data.path)) throw new Error('Choose a local file or folder.');
          const target = await realpath(path.resolve(base, data.path));
          if ((await stat(target)).isDirectory()) { native({ type: 'reveal', path: target }); return json(response, 200, { shown: 'folder', path: target }); }
          const preview = await files.preview(target); show('workspace', { preview });
          return json(response, 200, { shown: 'preview', path: preview.path });
        }
        if (method === 'GET' && url.pathname === '/api/history') return json(response, 200, history(url.searchParams.get('q') || ''));
        if (method === 'POST' && url.pathname === '/api/history/import') return json(response, 201, await sessions.importConversation(data));
        if (method === 'GET' && url.pathname === '/api/skill-locations') {
          const id=url.searchParams.get('projectId'),project=id?(await devspace.read()).projects.find(p=>p.id===id):null;
          if(id&&!project)throw Object.assign(Error('Project not found.'),{status:404});
          return json(response,200,await skillLocations(project?.path||repo));
        }
        if (method === 'GET' && url.pathname === '/api/files') return json(response, 200, await files.list(url.searchParams.get('path') || repo, url.searchParams.get('mode') || 'main', url.searchParams.get('q') || ''));
        if (method === 'POST' && url.pathname === '/api/files/pick') {
          if (typeof data.requestId !== 'string' || !/^[a-f\d-]{36}$/i.test(data.requestId)) throw new Error('Invalid file picker request.');
          native({ type: 'pick-files', window: 'chats', requestId: data.requestId });
          return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/files/drag') {
          const paths = await dragFiles(data.paths);
          native({ type: 'drag-files', window: 'workspace', paths });
          return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/files/move') {
          const result = await moveFile(data.path, data.folder);
          broadcast('workspace-changed', {});
          return json(response, 200, result);
        }
        if (method === 'POST' && url.pathname === '/api/files/recycle') {
          const file = await recyclePath(data.path, repo);
          native({ type: 'recycle-file', path: file });
          return json(response, 200, { requested: true, path: file });
        }
        if (method === 'GET' && url.pathname === '/api/preview') return json(response, 200, await files.preview(url.searchParams.get('path') || ''));
        if (method === 'POST' && url.pathname === '/api/files/markdown') {
          const preview = await files.saveMarkdown(data); await integrations.publish('artifact', { kind: 'updated', path: preview.path, name: preview.name }); broadcast('workspace-changed', {});
          return json(response, 200, preview);
        }
        if (method === 'POST' && url.pathname === '/api/settings') {
          if (data.display !== undefined) settings.display = displaySettings(data.display, settings.display);
          if (typeof data.agentRailCollapsed==='boolean')settings.agentRailCollapsed=data.agentRailCollapsed;
          if (data.spaceLayout && typeof data.spaceLayout === 'object') { const value=data.spaceLayout; settings.spaceLayout={projectId: String(value.projectId||'').slice(0,100),topicId:String(value.topicId||'all').slice(0,100),collapsed:!!value.collapsed,agentOpen:!!value.agentOpen,agentWidth:Math.max(320,Math.min(1400,Number(value.agentWidth)||500)),agentWide:!!value.agentWide,toolsWidth:Math.max(320,Math.min(10000,Number(value.toolsWidth)||settings.spaceLayout?.toolsWidth||520))}; }
          if (inventory().some(item => item.id === data.defaultAgent)) settings.defaultAgent = data.defaultAgent;
          if (typeof data.defaultBypass === 'boolean') settings.defaultBypass = data.defaultBypass;
          if (typeof data.allowDevspaceCommand === 'boolean') settings.allowDevspaceCommand = data.allowDevspaceCommand;
          if (Number.isInteger(data.terminalFontSize) && data.terminalFontSize >= 10 && data.terminalFontSize <= 24) settings.terminalFontSize = data.terminalFontSize;
          if (['focus', 'original'].includes(data.terminalAppearance)) settings.terminalAppearance = data.terminalAppearance;
          if (typeof data.terminalOptionMeta === 'boolean') settings.terminalOptionMeta = data.terminalOptionMeta;
          if (Number.isInteger(data.handoffAfter) && (data.handoffAfter === 0 || (data.handoffAfter >= 10 && data.handoffAfter <= 500))) settings.handoffAfter = data.handoffAfter;
          if (['full', 'compact', 'hidden'].includes(data.systemEvents)) settings.systemEvents = data.systemEvents;
          if (['ru', 'en'].includes(data.language)) settings.language = data.language;
          if (isThemePreference(data.workspaceTheme)) settings.workspaceTheme = data.workspaceTheme;
          if (isThemePreference(data.chatTheme)) settings.chatTheme = data.chatTheme;
          if (['medium', 'high'].includes(data.coordinatorEffort)) settings.coordinatorEffort = data.coordinatorEffort;
          if (['cedar', 'marin'].includes(data.voiceName)) settings.voiceName = data.voiceName;
          if (data.groupColors && typeof data.groupColors === 'object' && !Array.isArray(data.groupColors)) settings.groupColors = Object.fromEntries(Object.entries(data.groupColors).filter(([name, value]) => name.length <= 60 && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)).slice(0, 200).map(([name, value]) => [name, value.toLowerCase()]));
          if (Array.isArray(data.collapsedGroups)) settings.collapsedGroups = [...new Set(data.collapsedGroups.filter(item => typeof item === 'string' && item.length <= 60))].slice(0, 200);
          await saveSettings(); broadcast('settings', { settings });
          if (['ru', 'en'].includes(data.language)) native({ type: 'language', language: settings.language });
          return json(response, 200, settings);
        }
        if (method === 'POST' && url.pathname === '/api/sessions') { if(data.projectId && !(await devspace.read()).projects.some(p=>p.id===data.projectId))throw Object.assign(new Error('Проект не найден.'),{status:400});const agentSpaceId=data.spaceId||settings.selectedAgentSpaceId;if(!settings.agentSpaces.some(s=>s.id===agentSpaceId))throw Object.assign(Error('Agent space not found.'),{status:404});const session = await sessions.create({ ...data, bypass: data.bypass ?? settings.defaultBypass });settings.agentSessionSpaces={...settings.agentSessionSpaces,[session.id]:agentSpaceId};await saveSettings();broadcast('settings',{settings});if(data.projectId){settings.spaceSessionProjects={...(settings.spaceSessionProjects||{}),[session.id]:data.projectId};await saveSettings();broadcast('settings',{settings});} await integrations.publish('session', { event: 'started', session }); focus(session.id); return json(response, 201, session); }
        if (method === 'POST' && url.pathname === '/api/groups/move') return json(response, 200, await sessions.moveGroup(data.group, data.pinned, data.targetId, data.position));
        if (method === 'POST' && url.pathname === '/api/groups/rename') {
          // A renamed group keeps its color and collapsed state; merging into an
          // existing group keeps that group's.
          const from = groupLabel(data.from), to = groupLabel(data.to);
          const merging = sessions.list().some(item => item.group === to);
          const result = await sessions.renameGroup(from, to);
          if (from !== to) {
            const { [from]: color, ...colors } = settings.groupColors || {};
            settings.groupColors = color && !merging ? { ...colors, [to]: color } : colors;
            const collapsed = settings.collapsedGroups || [];
            settings.collapsedGroups = [...new Set(collapsed.filter(item => item !== from).concat(collapsed.includes(from) && !merging ? [to] : []))];
            await saveSettings(); broadcast('settings', { settings });
          }
          return json(response, 200, result);
        }
        if (method === 'POST' && url.pathname === '/api/groups/delete') {
          // The group's color and collapsed state go with it; the chats stay.
          const name = groupLabel(data.name);
          const result = await sessions.deleteGroup(name);
          const colors = { ...(settings.groupColors || {}) }; delete colors[name];
          settings.groupColors = colors;
          settings.collapsedGroups = (settings.collapsedGroups || []).filter(item => item !== name);
          await saveSettings(); broadcast('settings', { settings });
          return json(response, 200, result);
        }
        const sessionRoute = /^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/.exec(url.pathname);
        if (sessionRoute) {
          const [, id, action] = sessionRoute;
          if (method === 'GET' && action === 'screen') return json(response, 200, await sessions.read(id));
          if (method === 'GET' && action === 'messages') {
            const session = sessions.get(id);
            const value = await conversationMedia.present(await transcripts.read(session), session, 'desktop', grant => `/media/${session.id}/${grant}`);
            return json(response, 200, { ...value, prompt: session.process ? await readPrompt(sessions, id) : null });
          }
          if (method === 'GET' && action === 'commands') { const session = sessions.get(id); return json(response, 200, await chatCommands(session.agent, session.cwd, mcpOptions)); }
          if (method === 'GET' && action === 'stats') {
            const { supported, userMessages = 0, truncated = false, model = null } = await transcripts.read(sessions.get(id));
            return json(response, 200, { supported, userMessages, truncated, model, handoff: handoffs.state(id) });
          }
          if (method === 'POST' && action === 'handoff') return json(response, 200, await handoffs.start(id));
          if (method === 'POST' && action === 'prompt') return json(response, 200, await answerPrompt(sessions, id, data.id, data.choice));
          if (method === 'POST' && action === 'rewind') return json(response, 200, await rewindToMessage(sessions, transcripts, id, String(data.messageId || '')));
          if (method === 'POST' && action === 'speak') {
            const controller = new AbortController(), abort = () => controller.abort();
            sessions.get(id); response.once('close', abort);
            try {
              const audio = await readAloud.synthesize('desktop', data, controller.signal);
              response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store' }); response.end(audio); return;
            } finally { response.off('close', abort); }
          }
          if (method === 'POST' && action === 'send') {
            // One prompt: the text and any attached paths are pasted together, then submitted.
            const session = sessions.get(id), text = typeof data.text === 'string' ? data.text : '';
            const paths = Array.isArray(data.paths) && data.paths.length ? await attachments.paths(data.paths) : [];
            if (!text.trim() && !paths.length) throw new Error('Write a message or attach a file.');
            return json(response, 200, sessions.input(id, `${text}${paths.length ? `${text ? '\n' : ''}${attachmentText(paths, session.agent)}` : ''}`, { coordinator: true, submit: true }));
          }
          if (method === 'POST' && action === 'focus') return json(response, 200, focus(id));
          if (method === 'POST' && action === 'stop') return json(response, 200, sessions.stop(id));
          if (method === 'POST' && action === 'resume') { const session = await sessions.resume(id, data.nativeId); focus(id); return json(response, 200, session); }
          if (method === 'POST' && action === 'attach') return json(response, 200, await attach(id, data.paths));
          if (method === 'POST' && action === 'clear') return json(response, 200, await sessions.clearScreen(id));
          if (method === 'POST' && action === 'reorder') return json(response, 200, await sessions.reorder(id, data.targetId, data.position));
          if (method === 'POST' && action === 'input') return json(response, 200, sessions.input(id, data.text, { coordinator: data.paste !== false, submit: data.submit !== false }));
          if (method === 'PATCH' && !action) return json(response, 200, typeof data.pinned === 'boolean' ? sessions.pin(id, data.pinned) : 'tabColor' in data ? sessions.color(id, data.tabColor) : 'group' in data ? await sessions.assign(id, data.group) : sessions.rename(id, data.name));
          if (method === 'DELETE' && !action) return json(response, 200, await closeChat(id));
        }
        if (method === 'POST' && url.pathname === '/api/window') {
          if (!['chats', 'workspace'].includes(data.window) || !['show', 'hide', 'minimize', 'pin', 'zoom'].includes(data.action)) throw new Error('Unknown window action');
          if (data.action === 'zoom' && (!Number.isFinite(data.value) || data.value < .75 || data.value > 1.75)) throw Object.assign(Error('Недопустимый масштаб.'), { status: 400 });
          native({ type: 'window', action: data.action, window: data.window, value: data.action === 'zoom' ? data.value : !!data.value }); return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/reveal') {
          const file = await realpath(path.resolve(data.path));
          native({ type: 'reveal', path: file }); return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/coordinator') return json(response, 200, await askMak(data));
        if (method === 'POST' && url.pathname === '/api/coordinator/prepare') { await coordinator.start(); return json(response, 200, { ready: true, model: coordinator.model }); }
        if (method === 'POST' && url.pathname === '/api/live/transcript') {
          if (typeof data.id !== 'string' || data.id.length > 200 || !Array.isArray(data.captions)) throw new Error('A voice session and captions are required.');
          const captions = data.captions.slice(-50).filter(item => ['user', 'assistant'].includes(item.role) && typeof item.text === 'string').map(item => ({ role: item.role, text: item.text.slice(0, 1000), start: Number(item.start) || 0, end: Number(item.end) || 0 }));
          const transcript = { id: data.id, at: new Date().toISOString(), captions };
          voiceHistory = [...voiceHistory.filter(item => item.id !== data.id), transcript].slice(-12);
          const snapshot = voiceHistory;
          transcriptSave = transcriptSave.catch(() => {}).then(() => saveJson(transcriptPath, snapshot)); await transcriptSave;
          return json(response, 200, { saved: true });
        }
        if (method === 'POST' && url.pathname === '/api/live/release') {
          if (voiceOwner?.clientId === data.clientId) { voiceOwner = null; broadcast('voice-owner', { owner: null }); }
          return json(response, 200, { released: true });
        }
        if (method === 'POST' && url.pathname === '/api/live/session') {
          if (voiceOwner && voiceOwner.clientId !== data.clientId) throw new Error(`Voice is already active in the ${voiceOwner.surface} window`);
          if (typeof data.sdp !== 'string' || !data.sdp.trim() || typeof data.clientId !== 'string') throw new Error('A microphone connection is required');
          const keys = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
          const key = keys.OPENAI_API_KEY || keys.OPENAI_KEY || process.env.OPENAI_API_KEY;
          if (!key) throw new Error('Add OPENAI_API_KEY to the repository .env, then press the star again.');
          voiceOwner = { clientId: data.clientId, surface: data.surface === 'chats' ? 'chats' : 'workspace' };
          broadcast('voice-owner', { owner: voiceOwner });
          try {
            const result = await fetch('https://api.openai.com/v1/live/sessions', {
              method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
                body: JSON.stringify({ session: voiceSession(settings), transport: { type: 'webrtc', sdp: data.sdp } }),
            });
            const value = await result.json().catch(() => ({}));
            if (!result.ok) throw new Error(`OpenAI Live (${result.status}): ${value.error?.message || 'Session could not be started'}`);
            return json(response, 201, value);
          } catch (error) { voiceOwner = null; broadcast('voice-owner', { owner: null }); throw error; }
        }
        throw Object.assign(new Error('Endpoint not found'), { status: 404 });
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('Not allowed'), { status: 405 });
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const { file, info } = await realFile(uiDir, relative);
      if (!info.isFile()) throw new Error('File not found');
      await serveFile(request, response, file, info, {
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: ${files.origin}; media-src 'self' blob: ${files.origin}; connect-src 'self' ws://127.0.0.1:* ${files.origin}; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
      });
    } catch (error) { if (!response.headersSent) json(response, error.status || 400, { error: publicError(error) }); }
  });
  const origin = await listen(server);
  files.uiOrigin = origin;
  sessions.extraEnvironment = (session, env) => agentApi.environment(session, origin, env);
  sessions.allowDevspace = () => settings.allowDevspaceCommand === true;
  mobile = await new MobileGateway({ ...mobileOptions, transcripts, readAloud, dictation, chooseDictation, repo, uiDir, stateDir, sessions, attachments, closeChat, settings: () => settings, changed: state => broadcast('mobile-state', { mobile: state }) }).init();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, origin);
    if (request.headers.host !== new URL(origin).host || request.headers.origin !== origin || url.pathname !== '/events') { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.authenticated = false; ws.subscriptions = new Map(); ws.subscriptionVersion = 0;
    const authTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
    ws.on('message', async raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (!ws.authenticated) {
          if (message.type !== 'auth' || !equalSecret(message.token, token)) return ws.close(1008, 'Authentication failed');
          ws.authenticated = true; ws.clientId = message.clientId; ws.surface = message.surface; clients.add(ws); clearTimeout(authTimer);
          send(ws, 'connected', { sessions: sessions.list(), selectedId, coordinator: coordinator.state }); return;
        }
        if (message.type === 'subscribe') {
          sessions.get(message.id);
          if (!ws.subscriptions.has(message.id) && ws.subscriptions.size >= 4) throw Error('Можно наблюдать до четырёх терминалов.');
          const version = ++ws.subscriptionVersion; ws.subscriptions.set(message.id, version);
          const snapshot = await sessions.snapshot(message.id);
          if (ws.subscriptions.get(message.id) === version) send(ws, 'snapshot', snapshot);
        } else if (message.type === 'unsubscribe') ws.subscriptions.delete(message.id);
        else if (message.type === 'input') sessions.input(message.id, message.data);
        else if (message.type === 'resize') sessions.resize(message.id, message.cols, message.rows);
        else if (message.type === 'selected') { sessions.get(message.id); selectedId = message.id; settings.selectedId = selectedId; scheduleSettings(); }
        else if (message.type === 'seen' && ['chats', 'desktop'].includes(ws.surface) && ws.subscriptions.has(message.id) && selectedId === message.id) sessions.seen(message.id, message.completionVersion);
        else if (message.type === 'workspace-route') { workspaceRoute = String(message.route || '').slice(0, 500); settings.workspaceRoute = workspaceRoute; scheduleSettings(); }
        else if (message.type === 'ping') send(ws, 'pong', {});
      } catch (error) { send(ws, 'service-error', { error: publicError(error) }); }
    });
    ws.on('close', () => { clearTimeout(authTimer); clients.delete(ws); if (voiceOwner?.clientId === ws.clientId) { voiceOwner = null; broadcast('voice-owner', { owner: null }); } });
    ws.on('error', () => {});
  });
  let watcher;
  try { watcher = watch(path.join(repo, 'workspace', 'workspace.json'), () => broadcast('workspace-changed', {})); watcher.on('error', () => {}); } catch { /* Registry may be created after first setup. */ }
  const restoreTimer = restoreSessions ? setTimeout(() => sessions.restore().catch(error => sessions.emit('service-error', error)), 100) : null;
  return {
    origin, contentOrigin: files.origin, token, sessions, coordinator, quick, workspace, cards, files, projects, knowledge, integrations, mobile, devspace, plugins, operations, flows, commands, agentApi,
    urls: { workspace: `${origin}/?desktop=1&surface=workspace&token=${token}`, chats: `${origin}/?desktop=1&surface=chats&token=${token}` },
      nativeMessage: event => nativeSettings.receive(event),
      async close() {
        if (closing) return; closing = true; agentApi.close(); mcp.close(); nativeSettings.close(); await files.writes.catch(() => {});
      watcher?.close(); clearTimeout(restoreTimer); coordinator.close(); clearTimeout(settingsTimer); await saveSettings(); await transcriptSave; await quick.saves; await workspace.writes;
      dictation.close(); await mobile.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close(); await sessions.close();
      server.closeAllConnections(); contentServer.closeAllConnections();
      await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => contentServer.close(resolve)), files.close()]);
    },
  };
}
