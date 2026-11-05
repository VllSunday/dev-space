// Spaces organize one repository; they are not security or filesystem boundaries.
export const defaultSpace = 'default';
export const workflowStates = ['backlog', 'in-progress', 'review', 'blocked', 'done'];
export const priorities = ['normal', 'low', 'high', 'urgent'];
export const testingSections = ['Overview', 'Bugs', 'Wishlist', 'UX/UI', 'Test runs', 'Decisions'];
export function spacesOf(registry) {
  if (registry.spaces?.length) return registry.spaces;
  return [{ id: defaultSpace, name: 'Workspace', sections: [...new Set(registry.entities.map(e => e.category || 'other'))].map(id => ({ id, name: id })) }];
}
export const spaceOf = entity => entity.spaceId || defaultSpace;
export const workflowOf = entity => entity.status === 'done' ? 'done' : entity.workflow || 'backlog';
