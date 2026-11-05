// Only explicit, authored translations are selected. Arbitrary user content is never translated.
export function localizeEntity(entity, language) {
  const variant = language === 'ru' ? entity.locales?.ru : null;
  if (!variant || typeof variant !== 'object') return entity;
  return {
    ...entity,
    ...(typeof variant.title === 'string' ? { title: variant.title } : {}),
    ...(typeof variant.description === 'string' ? { description: variant.description } : {}),
    steps: (entity.steps || []).map((step, index) => ({
      ...step,
      ...(typeof variant.steps?.[index]?.name === 'string' ? { name: variant.steps[index].name } : {}),
      ...(typeof variant.steps?.[index]?.path === 'string' ? { path: variant.steps[index].path } : {}),
    })),
  };
}
