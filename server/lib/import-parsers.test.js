import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsvQuestions } from './import-parsers.js';

test('parseCsvQuestions extracts questions with expected headers', () => {
  const csv = [
    'pergunta,alt_a,alt_b,alt_c,alt_d,correta,explicacao',
    '"O que é RLS?","Row Level Security","Random","Foo","Bar",A,"Controle por linha"',
  ].join('\n');
  const out = parseCsvQuestions(Buffer.from(csv, 'utf-8'));
  assert.equal(out.questions.length, 1);
  assert.equal(out.questions[0].pergunta, 'O que é RLS?');
  assert.equal(out.questions[0].correta, 'A');
});

