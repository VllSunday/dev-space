// Legacy sessions belong to the original local space, regardless of list order.
export function sessionSpaceId(settings, sessionId) {
 const spaces=settings.agentSpaces||[],owner=settings.agentSessionSpaces?.[sessionId];
 return spaces.some(s=>s.id===owner)?owner:spaces.find(s=>s.id==='local')?.id||spaces[0]?.id||'local';
}
