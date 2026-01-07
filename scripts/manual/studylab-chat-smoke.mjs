import handler from "../../server/api-handlers/ai-study-chat.js";

const createReqRes = ({ body, headers = {} }) => {
  const req = {
    method: "POST",
    body,
    headers,
    query: {},
  };

  let statusCode = 200;
  let jsonBody = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader() {
      return this;
    },
    send(payload) {
      jsonBody = payload;
      return this;
    },
    json(payload) {
      jsonBody = payload;
      return this;
    },
  };

  const done = () => ({ statusCode, body: jsonBody });
  return { req, res, done };
};

const run = async () => {
  const language = "pt-BR";
  const session_id = "11111111-1111-4111-8111-111111111111";

  const first = {
    mode: "oracle",
    session_id,
    quality: "instant",
    use_web: true,
    messages: [
      { role: "user", content: "Quais cuidados ao medir TTR em transformadores Dyn1 com equipamento monofásico?" },
    ],
    language,
    attachments: [],
  };

  const { req: req1, res: res1, done: done1 } = createReqRes({ body: first });
  await handler(req1, res1);
  const r1 = done1();
  console.log("FIRST", r1.statusCode, r1.body?.success, r1.body?.meta?.model, r1.body?.meta?.truncated);
  if (!r1.body?.success) {
    console.error(r1.body);
    process.exitCode = 1;
    return;
  }

  const second = {
    ...first,
    quality: "instant",
    messages: [
      { role: "user", content: first.messages[0].content },
      { role: "assistant", content: r1.body?.answer || "" },
      { role: "user", content: "E Dyn1, onde entra nisso?" },
    ],
  };

  const { req: req2, res: res2, done: done2 } = createReqRes({ body: second });
  await handler(req2, res2);
  const r2 = done2();
  console.log("SECOND", r2.statusCode, r2.body?.success, r2.body?.meta?.model, r2.body?.meta?.truncated);
  if (!r2.body?.success) {
    console.error(r2.body);
    process.exitCode = 1;
  }
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

