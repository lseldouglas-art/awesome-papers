import { createProject, executeCommand } from './domain.mjs';

// This is a disclosed interaction fixture, not literature or model output.
export function createWorkspace(state, body, operationId) {
  const example = body.example === true;
  const p = createProject(state, example ? { name: '数字学习研究', goal: '我想研究数字学习，但还不了解这个领域。' } : body);
  p.example = example;
  const run = (name, payload) => executeCommand(state, p.id, name, payload, operationId);
  let sourceAccessIds = [];
  if (example) {
    const source = run('import-source', { title: '数字学习 · 交互示例材料（虚构）', contentLevel: 'excerpt',
      text: '本材料仅用于界面与保存测试，不是文献。示例将数字学习分为学习行为、教学设计与学习评价。学习评价中，需要区分学习过程与学习结果。本示例不提供真实研究现状、方法效果或研究空白的证据。' });
    source.origin = 'synthetic_fixture'; source.provenance = 'disclosed_interaction_example';
    const access = run('record-access', { sourceId: source.id, level: 'excerpt' });
    access.actor = 'example_fixture'; access.method = 'fixture_content';
    sourceAccessIds = [access.id];
  }
  const blocks = example ? [
    { id: 'overview', type: 'paragraph', text: '先了解研究分支，再选择想深入的问题。' },
    { id: 'branches', type: 'heading', text: '研究分支' },
    { id: 'behavior', type: 'candidate', text: '学习行为\n观察学习过程' },
    { id: 'design', type: 'candidate', text: '教学设计\n组织教学活动' },
    { id: 'evaluation', type: 'candidate', text: '学习评价\n衡量学习结果' },
    { id: 'question-heading', type: 'heading', text: '主要问题' },
    { id: 'question', type: 'paragraph', text: '一个起点：如何衡量学习过程与结果？' },
    { id: 'unknown-heading', type: 'heading', text: '待继续了解' },
    { id: 'unknown', type: 'paragraph', text: '这里需要区分学习过程与学习结果。后续比较两类评价目标，并通过真实文献了解已有方法及其适用条件。' },
    { id: 'next-heading', type: 'heading', text: '下一步' },
    { id: 'next', type: 'paragraph', text: '先记录你更关心的问题，再补充能支持比较的实际材料。' },
  ] : [
    { id: 'intent-heading', type: 'heading', text: '当前想法' },
    { id: 'intent', type: 'paragraph', text: p.goal },
    { id: 'understanding-heading', type: 'heading', text: '已有认识' },
    { id: 'understanding', type: 'paragraph', text: '' },
    { id: 'unknown-heading', type: 'heading', text: '待继续了解' },
    { id: 'unknown', type: 'paragraph', text: '' },
    { id: 'next-heading', type: 'heading', text: '下一步' },
    { id: 'next', type: 'paragraph', text: '' },
  ];
  const { artifact, revision } = run('create-artifact', { kind: 'brief', title: example ? '数字学习，从三个方向开始' : '领域理解与研究记录', blocks, sourceAccessIds });
  if (example) {
    run('add-evidence', { target: { artifactId: artifact.id, revisionId: revision.id, blockId: 'question' }, accessId: sourceAccessIds[0],
      relation: 'context', informationStatus: 'reported', quote: '学习评价中，需要区分学习过程与学习结果。', interpretation: '虚构交互样本，仅用于检查摘录定位。' });
  }
  run('create-conversation', { title: '课题交流' });
  return p;
}
