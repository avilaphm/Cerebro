import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditBlog,
  normaliseResearchPacket,
  parseJsonObject,
  slugifyBlogTitle,
} from '../supabase/functions/_shared/blog-system.ts';

test('normaliseResearchPacket keeps sourced angles and removes unknown URLs', () => {
  const packet = normaliseResearchPacket({
    findings: ['Monthly reporting remains manual.'],
    audience_language: ['We rebuild the same deck every month.'],
    sources: [{
      title: 'Infrastructure report',
      url: 'https://example.com/report',
      publisher: 'Example Institute',
      published_at: '2026-07-01',
      source_type: 'primary',
      key_fact: 'Reporting cycles are delayed by repeated data preparation.',
    }],
    angles: [{
      id: 'angle-1',
      working_title: 'The report was late before Word opened',
      target_reader: 'Project controls directors',
      opening_scene: 'A planner compares two programme exports at 9 pm.',
      central_tension: 'Senior judgement is trapped behind manual comparison.',
      belief_shift: 'The first constraint is data preparation, not report writing.',
      real_case: 'A public infrastructure reporting example.',
      practical_takeaway: 'Measure preparation time separately from review time.',
      source_urls: ['https://example.com/report', 'https://made-up.invalid/story'],
    }],
  });

  assert.equal(packet.sources.length, 1);
  assert.deepEqual(packet.angles[0].source_urls, ['https://example.com/report']);
});

test('auditBlog accepts a sourced long-form article that passes the structural gate', () => {
  const paragraph = 'The planner has the judgement to explain the change, but first has to rebuild the evidence from two programme exports. ';
  const article = [
    `${paragraph.repeat(6)}[Industry report](https://example.com/report)`,
    '## The comparison happens before the analysis',
    paragraph.repeat(17),
    '## Senior time disappears into preparation',
    `${paragraph.repeat(17)}[Public project data](https://example.com/project)`,
    '## The system should prepare, not decide',
    paragraph.repeat(17),
    '## What to take back to work',
    paragraph.repeat(8),
  ].join('\n\n');

  assert.deepEqual(auditBlog(article), []);
});

test('auditBlog flags unsupported editorial patterns', () => {
  const issues = auditBlog('This AI-powered solution is a game-changer — really.');
  assert.ok(issues.some((issue) => issue.includes('em dashes')));
  assert.ok(issues.some((issue) => issue.includes('ai-powered')));
  assert.ok(issues.some((issue) => issue.includes('game-changer')));
  assert.ok(issues.some((issue) => issue.includes('inline Markdown source links')));
});

test('JSON parsing and slug generation tolerate model wrappers', () => {
  assert.deepEqual(parseJsonObject('```json\n{"title":"A report"}\n```'), { title: 'A report' });
  assert.equal(slugifyBlogTitle('The Report Was Late: Before Word Opened'), 'the-report-was-late-before-word-opened');
});
