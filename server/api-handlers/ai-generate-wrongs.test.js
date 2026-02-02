import test from 'node:test';
import assert from 'node:assert/strict';

const makeRes = () => {
  const state = { statusCode: 200, json: null, sent: null };
  const res = {
    status(code) {
      state.statusCode = code;
      return res;
    },
    json(payload) {
      state.json = payload;
      return res;
    },
    send(payload) {
      state.sent = payload;
      return res;
    },
    get state() {
      return state;
    },
  };
  return res;
};

test('ai-generate-wrongs: returns 3 distractors (fallback path)', async () => {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = '';
  const { default: handler } = await import('./ai-generate-wrongs.js');
  process.env.OPENAI_API_KEY = prev;

  const req = {
    method: 'POST',
    body: {
      question: 'Qual é a finalidade de um disjuntor em uma instalação elétrica?',
      correct: 'Interromper automaticamente o circuito em caso de falha/sobrecorrente.',
      difficulty: 'basico',
      language: 'pt-BR',
      count: 3,
    },
    headers: {},
  };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.state.statusCode, 200);
  assert.ok(res.state.json);
  assert.ok(Array.isArray(res.state.json.wrong));
  assert.equal(res.state.json.wrong.length, 3);

  const wrongTexts = res.state.json.wrong.map((w) => String(w?.text || '').trim()).filter(Boolean);
  assert.equal(wrongTexts.length, 3);
  assert.ok(wrongTexts.every((t) => !/smart\s*line/i.test(t)));
  assert.ok(wrongTexts.every((t) => !t.toLowerCase().includes('interromper automaticamente o circuito')));
});

