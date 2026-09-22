import { DomainError, requireThat } from './errors.mjs';

export const MODEL_OUTPUT_PARSER_VERSION = 'outer-json-fences-v1';
const structureError = () => new DomainError('model_structure', 502, '模型输出不是完整且独立的 JSON 对象，原始响应与已有成果保持不变。');

function leadingBoundary(text) {
  if (typeof text !== 'string') throw structureError();
  const whitespace = text.match(/^\s*/)[0].length;
  const remainder = text.slice(whitespace);
  // A wrapper marker may be incomplete, but must be directly outside JSON.
  // No prose prefix, interior repair, JSON balancing or quote replacement.
  const opening = remainder.match(/^`+(?:json)?[ \t\r\n]*(?=[{\[])/i)?.[0] ?? '';
  return whitespace + opening.length;
}

export function normalizeOuterJsonFence(text) {
  const start = leadingBoundary(text);
  return text.slice(start).trim().replace(/\s*`+$/, '').trim();
}

export function parseModelJsonObject(text) {
  try {
    const value = JSON.parse(normalizeOuterJsonFence(text));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Preserve the original response; never repair JSON contents. */ }
  throw structureError();
}

/** The application may normalize a complete leading object and audit the tail.
 * Strict validators still parse one object; no scientific contents are repaired.
 * Preserve the extracted object exactly, with excluded wrapper/prose available
 * for inspection; a second structural payload is ambiguous and rejected. */
export function extractLeadingJsonObject(text) {
  const start = leadingBoundary(text);
  requireThat(text[start] === '{', 'model_structure', '已保存输出必须以明确的 JSON 对象开始，不能从任意正文中猜取内容。', 502);
  const stack = []; let string = false, escape = false, end = null;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (string) {
      if (escape) escape = false;
      else if (character === '\\') escape = true;
      else if (character === '"') string = false;
      continue;
    }
    if (character === '"') { string = true; continue; }
    if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      requireThat(stack.pop() === expected, 'model_structure', '已保存 JSON 的括号结构不完整，不能本地恢复。', 502);
      if (!stack.length) { end = index + 1; break; }
    }
  }
  requireThat(end !== null && !string, 'model_structure', '已保存 JSON 对象尚未完整结束，不能猜补内容。', 502);
  const jsonText = text.slice(start, end), excludedOutput = text.slice(end), excludedPrefix = text.slice(0, start);
  // Even a partly written second structured object is ambiguous. Do not choose
  // one of multiple possible payloads or hide an additional answer in a note.
  requireThat(!/[{\[]/.test(excludedOutput), 'ambiguous_model_output', '对象之后还有另一段对象或数组结构，请人工查看原始输出；未自动选择其中一份。', 502);
  const value = parseModelJsonObject(jsonText);
  return { value, jsonText, excludedOutput, excludedPrefix, parserVersion: MODEL_OUTPUT_PARSER_VERSION,
    operation: 'explicit_leading_object_extraction', contentRewritten: false };
}

/** Normalize only a known misspelled structural key, outside string values.
 * Original bytes and the exact edit list remain available in call provenance. */
export function normalizeModelOutput(text) {
  try { parseModelJsonObject(text); return null; } catch { /* Check supported wrappers. */ }
  try { return extractLeadingJsonObject(text); } catch { /* Check known key typo. */ }
  let quoted = false, escaped = false, corrected = '', edits = [];
  for (let i = 0; i < text.length; i++) {
    if (!quoted && text.startsWith('"fields:', i) && /[{,]\s*$/.test(corrected)
      && /^"fields:\s*\{\s*"(?:subject|methods|findings|relevance|unreported)"\s*:/.test(text.slice(i))) {
      corrected += '"fields":'; edits.push({offset:i + 7,insert:'"'}); i += 7; continue;
    }
    const ch = text[i]; corrected += ch;
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
    else if (ch === '"') quoted = true;
  }
  if (!edits.length) return null;
  try {
    const result = extractLeadingJsonObject(corrected);
    if (result.value.framework !== 'domain-landscape-v1' || !Array.isArray(result.value.papers)) return null;
    return {...result, operation:'repair_fields_key_quote', syntaxEdits:edits, contentRewritten:false};
  } catch { return null; }
}
