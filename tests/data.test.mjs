import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBackup, publishingCaption, validURL } from '../js/data.mjs';

const story = {
  id: '1750000000000', en: 'Harbour update', dv: 'ބަނދަރު', category: 'Local news',
  location: 'Kulhudhuffushi', source: 'https://example.org/article', bodyEn: '', bodyDv: 'ޚަބަރު',
  verified: true, status: 'Approved'
};

test('restores an original local backup with bilingual stories', () => {
  const sources = [{ name: 'Local outlet', url: 'https://example.org' }];
  assert.deepEqual(normalizeBackup({ stories: [story], sources }), { stories: [story], sources });
});

test('rejects duplicate IDs and unsafe sources at restore time', () => {
  assert.throws(() => normalizeBackup({ stories: [story, story], sources: [] }));
  assert.throws(() => normalizeBackup({ stories: [], sources: [{ name: 'Unsafe', url: 'javascript:alert(1)' }] }));
  assert.equal(validURL('https://example.org'), true);
});

test('exports only approved, verified copies with valid sources', () => {
  assert.equal(publishingCaption(story), 'Harbour update\n\nބަނދަރު\n\nޚަބަރު\n\nhttps://example.org/article');
  for (const changes of [{ status: 'Draft' }, { status: 'Posted' }, { verified: false }, { source: '' }]) {
    assert.throws(() => publishingCaption({ ...story, ...changes }));
  }
});
