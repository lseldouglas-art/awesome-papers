import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceNumbers, materialPacket, outlineGroups, sourcePassages } from '../../shared/material-scope.mjs';
test('paper numbers persist across subset changes and distinct snapshots remain addressable', () => {
  const project = { sources: { s1: { id: 's1', title: 'First', origin: 'pubmed', pmid: '1' }, s2: { id: 's2', title: 'Second', origin: 'pubmed', pmid: '2' }, s3: { id: 's3', title: 'First updated', origin: 'pubmed', pmid: '1' } }, accesses: { a1: { id: 'a1', sourceId: 's1', level: 'abstract', text: 'Original.' }, a2: { id: 'a2', sourceId: 's2', level: 'abstract', text: 'Second.' }, a3: { id: 'a3', sourceId: 's3', level: 'abstract', text: 'Updated.' } } };
  assert.deepEqual(referenceNumbers(project), { s1: 1, s2: 2, s3: 1 });
  const packet = materialPacket(project, ['a1', 'a3', 'a2']);
  assert.deepEqual(packet.map(m => m.ref), ['R1', 'R1v2', 'R2']);
  assert.deepEqual(packet.map(m => m.text), ['Original.', 'Updated.', 'Second.']);
  assert.equal(materialPacket(project, ['a2'])[0].ref, 'R2');
  assert.deepEqual(referenceNumbers(JSON.parse(JSON.stringify(project))), referenceNumbers(project));
});
test('outline retains section headings and assigns paragraphs and branches to their parent', () => {
  const blocks = [{ id: 'h1', type: 'heading', text: '概览' }, { id: 'p1', type: 'paragraph', text: '内容' }, { id: 'h2', type: 'heading', text: '分支' }, { id: 'b1', type: 'candidate', text: '分支一' }];
  const groups = outlineGroups(blocks); assert.equal(groups.length, 2); assert.equal(groups[0].children[0].id, 'p1'); assert.equal(groups[1].children[0].id, 'b1');
});

test('passage anchors partition all text losslessly including whitespace and long paragraphs', () => {
  for (const text of ['One sentence.  Two!\n最后一段。', '无标点的内容'.repeat(20000), '😀 punctuation. '.repeat(1000)]) {
    const passages = sourcePassages(text); assert.equal(passages.map(p => p.text).join(''), text);
    for (const p of passages) assert.equal(text.slice(p.start, p.end), p.text);
  }
});
