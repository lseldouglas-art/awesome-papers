import {researchHeading} from '../../shared/research-labels.mjs';
import { outlineGroups } from '../../shared/material-scope.mjs';

export function ResearchOutline({ blocks, selected, onJump, onTop, onSources, sourceCount, artifactLabel = '领域简报' }) {
  const groups = outlineGroups(blocks);
  const personal = groups.filter(b => b.id.startsWith('note-'));
  const research = groups.filter(b => !b.id.startsWith('note-'));
  return <nav className="research-outline" aria-label="本页大纲">
    <button className="outline-entry" onClick={onTop}>本页开始与接续</button>
    {[{ title: artifactLabel, groups: research }, { title: '我的研究记录', groups: personal }].filter(g => g.groups.length).map(root => <details className="outline-level-one" key={root.title} open><summary>{root.title}</summary><ul>{root.groups.map(group => <li key={group.id}>
      <button className={selected === group.id || group.children.some(b => b.id === selected) ? 'selected' : ''} aria-current={selected === group.id || group.children.some(b => b.id === selected) ? 'location' : undefined} onClick={() => onJump(group.id)}>{researchHeading(group)}</button>
    </li>)}</ul></details>)}
    <button className="outline-entry" onClick={onSources}>参考文献 <small>{sourceCount || ''}</small></button>
  </nav>;
}
