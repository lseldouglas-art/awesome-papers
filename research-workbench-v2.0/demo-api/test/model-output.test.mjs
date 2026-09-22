import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOuterJsonFence, parseModelJsonObject, extractLeadingJsonObject } from '../src/model-output.mjs';
import { validateResearchOutput } from '../src/research.mjs';
import { validatePaperBatchOutput, planMaterialBatches } from '../src/workflows.mjs';
import { dimensionFixture } from './landscape-fixture.mjs';

const object = { text: '字符串内的 `、``、``` 与 { [ ] } 都原样保留。', escaped: '引号 " 和反斜杠 \\ 也不能改变' };

test('strict JSON parser accepts plain JSON and complete or incomplete outer fences without editing content', () => {
  const json = JSON.stringify(object);
  for (const wrapped of [json, `\n ${json}\n`, `\`\`\`json\n${json}\n\`\`\``, `${json}\n\`\``, `\`\`json\n${json}\n\`\``, `\`\`\`\n${json}\n\``]) {
    assert.deepEqual(parseModelJsonObject(wrapped), object); assert.equal(normalizeOuterJsonFence(wrapped), json);
  }
});

test('automatic parser rejects arbitrary trailing prose, multiple payloads and malformed interior JSON', () => {
  for (const raw of ['{"ok":true}说明：额外正文', '{"ok":true}\n``**说明**：这是尾注', '说明：{"ok":true}', '{"ok":true}\n{}', '{"ok":true}\n[]', '{"ok":tru}', '{"ok":"unfinished}', '{"ok":true,}', '```json\n{"ok":true}\n```尾正文']) {
    assert.throws(() => parseModelJsonObject(raw), e => e.code === 'model_structure');
  }
});

test('explicit extraction finds the exact leading root with string escapes and retains excluded note verbatim', () => {
  const json = JSON.stringify(object), prefix = '```json\n', note = '\n``**说明**：附加说明保持可查看，但不作为研究成果。';
  const result = extractLeadingJsonObject(prefix + json + note);
  assert.equal(result.jsonText, json); assert.deepEqual(result.value, object); assert.equal(result.excludedOutput, note); assert.equal(result.excludedPrefix, prefix);
  assert.equal(result.contentRewritten, false);
});

test('explicit recovery still refuses a second object/array, prose prefix, incomplete root or interior repair', () => {
  for (const raw of ['{"ok":true}\n{"other":false}', '{"ok":true}\n说明：[]', '说明：{"ok":true}', '{"ok":"unfinished}', '{"ok":true,}', '{"ok":true}\n第二段 {']) {
    assert.throws(() => extractLeadingJsonObject(raw));
  }
});

test('research and per-paper validators share envelope parsing while keeping scientific checks', () => {
  const materials = [{ ref: 'R1', accessId: 'a1', sourceId: 's1', text: 'A recorded engineering observation.', level: 'abstract' }], data = dimensionFixture(materials);
  assert.equal(validateResearchOutput(JSON.stringify(data) + '\n``', 'landscape', materials, { requirePaperNotes: true, requireDimensions: true }).dimensions.length, 7);
  assert.equal(validatePaperBatchOutput(JSON.stringify(data) + '\n``', planMaterialBatches(materials).batches[0]).papers.length, 1);
  data.sections[0].items[0].citations = [];
  assert.throws(() => validateResearchOutput(JSON.stringify(data) + '\n``', 'landscape', materials, { requirePaperNotes: true, requireDimensions: true }), e => e.code === 'unsupported_claim');
});

test('known fields-key quote typo is normalized without changing scientific values or accepting truncated data',async()=>{
 const {normalizeModelOutput}=await import('../src/model-output.mjs');
 const material={ref:'R1',accessId:'a1',sourceId:'s1',level:'abstract',text:'Observed evidence.'};
 const data=dimensionFixture([material]);delete data.sections;
 data.papers[0].fields.findings.text='字面提及 "fields:{，应原样保留';
 const valid=JSON.stringify(data),bad=valid.replace('"fields":{','"fields:{');
 const result=normalizeModelOutput('````json\n'+bad+'\n````');
 assert.equal(result.operation,'repair_fields_key_quote');assert.equal(result.syntaxEdits.length,1);assert.deepEqual(result.value,data);
 assert.equal(validatePaperBatchOutput(result.jsonText,planMaterialBatches([material]).batches[0]).papers.length,1);
 assert.equal(normalizeModelOutput(bad.slice(0,-4)),null);
 assert.equal(normalizeModelOutput(bad+'\n{}'),null);
 assert.equal(normalizeModelOutput('{"fields:{"subject":{},"secret":"fabricate"}'),null);
});

test('batch recovery retains independently valid papers, quarantines malformed and duplicated records',async()=>{
 const {recoverPaperBatch}=await import('../src/workflows.mjs');
 const materials=Array.from({length:50},(_,i)=>({ref:`R${i+1}`,accessId:`a${i}`,sourceId:`s${i}`,level:'abstract',text:'Observed evidence.'}));
 const batch=planMaterialBatches(materials).batches[0],data=dimensionFixture(materials);delete data.sections;
 data.papers[7].fields.findings.text='INVALID_VALUE_HERE';
 const raw=JSON.stringify(data,null,2).replace('INVALID_VALUE_HERE','unescaped " quote');
 const recovered=recoverPaperBatch(raw,batch);
 assert.equal(recovered.papers.length,49);assert.ok(!recovered.papers.some(p=>p.ref==='R8'));
 const duplicate={...data,papers:[...data.papers,data.papers[0]]};assert.equal(recoverPaperBatch(JSON.stringify(duplicate),batch).papers.length,49);
 assert.equal(recoverPaperBatch('untrusted prose prefix'+raw,batch).papers.length,0);
});
