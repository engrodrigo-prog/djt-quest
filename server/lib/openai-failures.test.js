import assert from "node:assert/strict";
import test from "node:test";

import { classifyOpenAiFailure } from "./openai-failures.js";

test("classifyOpenAiFailure: extracts JSON error message", () => {
  const err = classifyOpenAiFailure(
    JSON.stringify({
      error: {
        message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.",
        type: "invalid_request_error",
      },
    }),
  );
  assert.equal(err.code, "unsupported_parameter");
});

test("classifyOpenAiFailure: quota exceeded", () => {
  const err = classifyOpenAiFailure("insufficient_quota: You exceeded your current quota");
  assert.equal(err.code, "quota_exceeded");
  assert.match(err.message, /quota/i);
});

test("classifyOpenAiFailure: invalid api key", () => {
  const err = classifyOpenAiFailure("Incorrect API key provided");
  assert.equal(err.code, "invalid_api_key");
});

test("classifyOpenAiFailure: model error", () => {
  const err = classifyOpenAiFailure("The model `gpt-5-nano-2025-08-07` does not exist");
  assert.equal(err.code, "model");
});

test("classifyOpenAiFailure: unknown returns clamped message", () => {
  const err = classifyOpenAiFailure("Some random failure");
  assert.equal(err.code, "unknown");
  assert.equal(err.message, "Some random failure");
});

