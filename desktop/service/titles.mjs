export function chatTitle(value, fallback = 'New conversation') {
  const title = [...String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ')].slice(0, 100).join('') || fallback;
  if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(title)) {
    throw new Error('Names cannot contain control characters.');
  }
  return title;
}

export function groupLabel(value) {
  const label = String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!label) return null;
  if (label.length > 60) throw new Error('Keep the group name under 60 characters.');
  chatTitle(label);
  return label;
}

export function restoredTitle(value, index) {
  if (/^(codex|claude|antigravity|agy|opencode|kimi)$/i.test(value || '')) return `Conversation ${index + 1}`;
  try { return chatTitle(value, `Conversation ${index + 1}`); }
  catch { return /голос/i.test(value || '') ? 'Dev Space voice' : `Conversation ${index + 1}`; }
}

export function taskTitle(value) {
  const title = chatTitle(value, '');
  if (!title || !/\p{L}/u.test(title) || /^(?:untitled|без названия)(?:[\s#_-]*\d+)?$/i.test(title) || /^(?:(?:new|untitled|новый|новая)\s+)?(?:conversation|chat|session|task|чат|задача|сессия|codex|claude|antigravity|agy|opencode|kimi)(?:[\s#_-]*\d+)?$/i.test(title)) {
    throw new Error('Choose a descriptive task title before opening the chat, such as "Dream Game Combat" or "Workspace Files". Generic titles like "Conversation 1" are not allowed for coordinator-created chats.');
  }
  return title;
}
