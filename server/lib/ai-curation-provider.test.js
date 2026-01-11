import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonFromAiContent } from "./ai-curation-provider.js";

test("parseJsonFromAiContent: parses direct JSON", () => {
  const { parsed } = parseJsonFromAiContent('{"ok":true,"n":1}');
  assert.deepEqual(parsed, { ok: true, n: 1 });
});

test("parseJsonFromAiContent: parses fenced JSON", () => {
  const { parsed } = parseJsonFromAiContent("```json\n{\"a\":1}\n```");
  assert.deepEqual(parsed, { a: 1 });
});

test("parseJsonFromAiContent: extracts JSON from text and removes trailing commas", () => {
  const { parsed } = parseJsonFromAiContent('Segue o JSON:\n{"a":1, "b":[2,3,],}\nFim.');
  assert.deepEqual(parsed, { a: 1, b: [2, 3] });
});

test("parseJsonFromAiContent: repairs common LLM JSON issues (single quotes/unquoted keys)", () => {
  const { parsed } = parseJsonFromAiContent("{ title: 'abc', items: ['x','y',], }");
  assert.deepEqual(parsed, { title: "abc", items: ["x", "y"] });
});

test("parseJsonFromAiContent: returns null when no JSON is present", () => {
  const { parsed } = parseJsonFromAiContent("nenhum json aqui");
  assert.equal(parsed, null);
});

