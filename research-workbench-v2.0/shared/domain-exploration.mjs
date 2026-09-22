import { prose } from './domain-chapters.mjs';

// Legacy reports are read as saved. Only explicit structure creates subtopics;
// paper counts, titles and keyword matches never manufacture a research taxonomy.
export function explorationNodes(section) {
  return section.findings.map(block => ({
    id: block.id, title: prose(block.headline || block.visual?.label || block.text),
    text: prose(block.text), fullText: prose(block.text),
    status: block.informationStatus, blockId: block.id,
    children: (block.children ?? []).map(child => projectChild(child, block.id)),
    legacy: !block.children?.length,
    facets: !block.children?.length ? (block.visual?.nodes ?? []).map(n => ({ title: prose(n.label), text: prose(n.text) })) : [],
    boundary: prose(block.visual?.boundary || ''),
  }));
}
function projectChild(child, blockId) {
  return { id: child.id, title: prose(child.headline), text: prose(child.text),
    status: child.informationStatus, blockId,
    children: (child.children ?? []).map(c => projectChild(c, blockId)) };
}
