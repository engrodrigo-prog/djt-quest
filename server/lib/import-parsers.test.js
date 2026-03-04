import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkbookBuffer } from './excel-workbook.js';
import { parseCsvQuestions, parseXlsxQuestions } from './import-parsers.js';

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

test('parseXlsxQuestions extracts questions from xlsx buffers', async () => {
  const buf = await buildWorkbookBuffer({
    sheetName: 'Perguntas',
    rows: [
      ['pergunta', 'alt_a', 'alt_b', 'alt_c', 'alt_d', 'correta', 'explicacao'],
      ['O que e SEP?', 'Sistema Eletrico de Potencia', 'Foo', 'Bar', 'Baz', 'A', 'Contexto tecnico'],
    ],
  });
  const out = await parseXlsxQuestions(buf);
  assert.equal(out.sheet, 'Perguntas');
  assert.equal(out.questions.length, 1);
  assert.equal(out.questions[0].pergunta, 'O que e SEP?');
  assert.equal(out.questions[0].correta, 'A');
});

test('parseXlsxQuestions rejects legacy xls buffers with a clear message', async () => {
  await assert.rejects(
    () => parseXlsxQuestions(Buffer.from('legacy-xls', 'utf-8')),
    /Formato XLS legado nao suportado|Formato XLS legado não suportado/,
  );
});
