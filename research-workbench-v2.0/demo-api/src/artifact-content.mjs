export const noteLabels = Object.freeze({ intent: '当前想法', understanding: '已有认识', unknown: '待继续了解', next: '下一步' });

// Both manual captures and generated checkpoints retain the same readable record.
// Model result blocks stay separate from the researcher's own saved notes.
export function readableArtifactBlocks(resultBlocks, notes) {
  const blocks = structuredClone(resultBlocks ?? []);
  if (blocks.length) blocks.push({ id: 'my-notes-heading', type: 'heading', text: '我的研究记录' });
  for (const [key, label] of Object.entries(noteLabels)) {
    blocks.push({ id: `note-${key}-heading`, type: 'heading', text: label });
    blocks.push({ id: `note-${key}`, type: 'paragraph', text: notes[key], owner: 'user' });
  }
  return blocks;
}
