import assert from 'node:assert/strict';
import test from 'node:test';
import { composeArticle, pastedExcerpts, sourceLanguage } from '../js/article.mjs';

test('builds a bounded, attributed draft from enough source text', () => {
  const text = [
    'The island council announced that the new ferry terminal would open next week.',
    'The terminal will operate daily and have a waiting area for passengers.',
    'Council officials said the terminal is part of a wider transport programme.',
    'They expect the dock to improve access for residents of nearby islands.'
  ].join('\n');
  const excerpts = pastedExcerpts(text);
  assert.ok(excerpts.length >= 2);
  assert.ok(excerpts.reduce((sum, excerpt) => sum + excerpt.length, 0) <= 480);
  assert.ok(excerpts.every(excerpt => excerpt.endsWith('.')));
  assert.ok(excerpts.length < text.split('\n').length);
  assert.match(composeArticle({ headline: 'New ferry terminal', publisher: 'News outlet', excerpts, language: 'en' }),
    /^News outlet reported: “New ferry terminal”\n\nExcerpts from the original report/);
  assert.deepEqual(pastedExcerpts('A short headline'), []);
  assert.equal(sourceLanguage('ޚަބަރު Example'), 'dv');
});
