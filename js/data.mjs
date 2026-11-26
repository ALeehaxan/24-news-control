export const fields = ['category', 'location', 'source', 'en', 'bodyEn', 'dv', 'bodyDv'];
export const categories = ['Local news', 'Politics', 'Sports', 'Weather', 'Business', 'Health', 'Education', 'Public safety', 'Transport', 'Community', 'Development', 'Announcements'];
export const empty = () => ({ stories: [], sources: [], version: '' });

export function validURL(value) {
  try {
    return typeof value === 'string' && ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function normalizeBackup(data) {
  if (!Array.isArray(data?.stories) || !Array.isArray(data?.sources)) throw Error('Invalid backup');
  const ids = new Set();
  const stories = data.stories.map(story => {
    if (!story || typeof story.id !== 'string' || !story.id || ids.has(story.id) ||
        !fields.every(field => typeof story[field] === 'string') ||
        !categories.includes(story.category) || !(story.en.trim() || story.dv.trim()) ||
        !['Draft', 'Approved', 'Posted'].includes(story.status) ||
        typeof story.verified !== 'boolean' ||
        (story.status !== 'Draft' && (!story.verified || !validURL(story.source)))) {
      throw Error('Invalid story in backup');
    }
    ids.add(story.id);
    return { ...Object.fromEntries(fields.map(field => [field, story[field]])),
      id: story.id, status: story.status, verified: story.verified };
  });
  const sources = data.sources.map(source => {
    if (typeof source?.name !== 'string' || !source.name.trim() || !validURL(source.url)) {
      throw Error('Invalid source in backup');
    }
    return { name: source.name, url: source.url };
  });
  return { stories, sources };
}

export function publishingCaption(story) {
  if (story.status !== 'Approved' || !story.verified || !validURL(story.source)) {
    throw Error('Editorial approval is required.');
  }
  return [story.en, story.bodyEn, story.dv, story.bodyDv, story.source].filter(Boolean).join('\n\n');
}
