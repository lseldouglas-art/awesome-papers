import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { requireThat } from './errors.mjs';
import { parseModelJsonObject } from './model-output.mjs';
import { PAPER_FIELDS, LANDSCAPE_FRAMEWORK } from '../../shared/domain-landscape.mjs';
import { protocolFields } from '../../shared/research-continuity.mjs';
import { analysisDimensions } from '../../shared/question-analysis.mjs';
import { decisionTemplates } from '../../shared/question-assessment.mjs';

const string = { type: 'string' }, nonempty = { type: 'string', minLength: 1 };
const array = items => ({ type: 'array', items });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const citation = { ...object({ ref: { type: 'string', pattern: '^R[1-9][0-9]*(v[1-9][0-9]*)?$' }, passage: nonempty, quote: nonempty }, ['ref']),
  anyOf: [{ properties: { passage: nonempty }, required: ['passage'] }, { properties: { quote: nonempty }, required: ['quote'] }] };
const statement = object({ key: string, headline: string, text: nonempty,
  status: { enum: ['reported', 'inference', 'unknown', 'suggestion'] }, citations: array(citation) }, ['text', 'status', 'citations']);
const judgment = object({ recommendation: { enum: ['advance', 'conditional', 'narrow', 'defer'] }, reason: nonempty,
  claims: array(statement), unknowns: array(string), next: nonempty, changed: nonempty,
  questionProposal: {anyOf:[{type:'null'},object({title:nonempty,question:nonempty,scope:string,reason:nonempty})]},
  protocol: { anyOf: [{ type: 'null' }, object(Object.fromEntries(Object.keys(protocolFields).map(k => [k,
    { anyOf: [string, array(string)] }])), [])] } },
  ['recommendation', 'reason', 'claims', 'unknowns', 'next', 'changed']);
const texts = array(nonempty), indexes = array({type:'integer',minimum:0});
const comparisonStatement = object({text:nonempty,status:{enum:['reported','inference']},citations:{...array(citation),minItems:1}});
const assessment = object({
  version:{const:2},summary:nonempty,feasibility:nonempty,innovation:nonempty,value:nonempty,risks:{...texts,minItems:1},
  difficulty:object({level:{type:'integer',minimum:1,maximum:5},rationale:nonempty,assumptions:{...texts,minItems:1}}),
  estimates:{...array(object({label:nonempty,min:{type:'number',exclusiveMinimum:0},max:{type:'number',exclusiveMinimum:0},unit:{enum:['个月','人']},assumptions:{...texts,minItems:1},basis:nonempty,sensitivity:nonempty})),minItems:1},
  focus:object({question:nonempty,nextChecks:{...texts,minItems:1},axes:{...array(object({label:nonempty,description:nonempty})),minItems:2,maxItems:2},relation:nonempty},['question','nextChecks']),
  presentation:object({template:{enum:Object.keys(decisionTemplates)},reason:nonempty}),
  analysis:{...array(object({key:{enum:analysisDimensions.map(d=>d.key)},judgment:nonempty,reasoning:nonempty,checks:{...texts,minItems:1},basis:{enum:['inference','planning','unknown']},supporting:indexes,conflicting:indexes})),minItems:8,maxItems:8},
},['summary','feasibility','innovation','value','risks','difficulty','estimates','analysis']);
const schemas = {
  comparison:object({explanation:nonempty,next:nonempty,questions:array(object({
    title:nonempty,question:nonempty,scope:nonempty,rationale:nonempty,
    supporting:array(comparisonStatement),conflicting:array(comparisonStatement),unknowns:texts,
    feasibility:object({known:texts,unknown:texts}),
    proposal:object({paperTitle:nonempty,design:nonempty,primaryOutcome:nonempty,analysisPlan:nonempty,dataRequirements:texts,noveltyCheck:nonempty,contribution:nonempty}),
    assessment,
  },['question','scope','rationale','supporting','conflicting','unknowns','feasibility','assessment']))}),
  paper: object({ framework: { const: LANDSCAPE_FRAMEWORK }, papers: array(object({ ref: nonempty,
    fields: object(Object.fromEntries(Object.keys(PAPER_FIELDS).map(k => [k, object({ text: nonempty,
      status: { enum: ['reported', 'inference', 'unknown'] }, passages: array({ type: 'string', pattern: '^P[1-9][0-9]*$' }) })]))) })) }),
  initial: judgment,
  revised: judgment,
  challenge: object({ point: nonempty, why: nonempty, wouldChange: nonempty, needsSearch: { type: 'boolean' }, query: string,
    findings: array(statement), fulltext: { anyOf: [{ type: 'null' }, object({ accessId: nonempty, reason: nonempty })] } },
    ['point', 'why', 'wouldChange', 'needsSearch', 'query', 'findings']),
};
// Validation never coerces values, fills missing fields, removes properties or
// repairs facts. Source/coverage/domain validators remain authoritative.
const ajv = new Ajv({ allErrors: true, strict: true });
const contracts = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, {
  name, version: name === 'initial' || name === 'revised' ? 'research-output-v3' : 'research-output-v1', schema,
  fingerprint: createHash('sha256').update(JSON.stringify(schema)).digest('hex'), validate: ajv.compile(schema),
}]));
export function outputContractFor(purpose, mode) {
  if (mode === 'compare' && ['model.generate','model.topic-synthesis'].includes(purpose)) return contracts.comparison;
  if (/^model\.(?:paper-extraction(?:-repair)?|investigation-extraction)$/.test(purpose)) return contracts.paper;
  return contracts[purpose?.match(/^model\.investigation-(initial|challenge|revised)$/)?.[1]] ?? null;
}
export function validateModelContract(raw, contract) {
  if (!contract) return;
  const value = parseModelJsonObject(raw);
  requireThat(contract.validate(value), 'model_structure', '模型输出未满足本步字段约定；原始输出已保留，可继续未完成部分。', 502,
    { contract: contract.name, version: contract.version, fields: (contract.validate.errors ?? []).map(e => ({ path: e.instancePath, rule: e.keyword })) });
}
