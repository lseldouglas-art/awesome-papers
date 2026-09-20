import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { requireThat } from './errors.mjs';
import { parseModelJsonObject } from './model-output.mjs';
import { PAPER_FIELDS, LANDSCAPE_FRAMEWORK } from '../../shared/domain-landscape.mjs';
import { protocolFields } from '../../shared/research-continuity.mjs';

const string = { type: 'string' }, nonempty = { type: 'string', minLength: 1 };
const array = items => ({ type: 'array', items });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const citation = { ...object({ ref: { type: 'string', pattern: '^R[1-9][0-9]*(v[1-9][0-9]*)?$' }, passage: nonempty, quote: nonempty }, ['ref']),
  anyOf: [{ properties: { passage: nonempty }, required: ['passage'] }, { properties: { quote: nonempty }, required: ['quote'] }] };
const statement = object({ key: string, headline: string, text: nonempty,
  status: { enum: ['reported', 'inference', 'unknown', 'suggestion'] }, citations: array(citation) }, ['text', 'status', 'citations']);
const judgment = object({ recommendation: { enum: ['advance', 'conditional', 'narrow', 'defer'] }, reason: nonempty,
  claims: array(statement), unknowns: array(string), next: nonempty, changed: nonempty,
  protocol: { anyOf: [{ type: 'null' }, object(Object.fromEntries(Object.keys(protocolFields).map(k => [k, string])), [])] } },
  ['recommendation', 'reason', 'claims', 'unknowns', 'next', 'changed']);
const schemas = {
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
  name, version: 'research-output-v1', schema,
  fingerprint: createHash('sha256').update(JSON.stringify(schema)).digest('hex'), validate: ajv.compile(schema),
}]));
export function outputContractFor(purpose) {
  if (/^model\.(?:paper-extraction(?:-repair)?|investigation-extraction)$/.test(purpose)) return contracts.paper;
  return contracts[purpose?.match(/^model\.investigation-(initial|challenge|revised)$/)?.[1]] ?? null;
}
export function validateModelContract(raw, contract) {
  if (!contract) return;
  const value = parseModelJsonObject(raw);
  requireThat(contract.validate(value), 'model_structure', '模型输出未满足本步字段约定；原始输出已保留，可继续未完成部分。', 502,
    { contract: contract.name, version: contract.version, fields: (contract.validate.errors ?? []).map(e => ({ path: e.instancePath, rule: e.keyword })) });
}
