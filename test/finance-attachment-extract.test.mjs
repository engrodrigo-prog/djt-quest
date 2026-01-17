import test from "node:test";
import assert from "node:assert/strict";

import { parseStorageRefFromUrl, buildFinanceAiJsonPath, buildFinanceCsvPath } from "../server/finance/attachment-extract.js";

test("finance attachment extract: parses storage ref from public url", () => {
  const base = "https://eyuehdefoedxcunxiyvb.supabase.co";
  const url =
    "https://eyuehdefoedxcunxiyvb.supabase.co/storage/v1/object/public/evidence/finance-requests/u123/file.jpg";
  assert.deepEqual(parseStorageRefFromUrl(base, url), {
    bucket: "evidence",
    path: "finance-requests/u123/file.jpg",
  });
});

test("finance attachment extract: parses storage ref from signed url", () => {
  const base = "https://eyuehdefoedxcunxiyvb.supabase.co";
  const url =
    "https://eyuehdefoedxcunxiyvb.supabase.co/storage/v1/object/sign/evidence/finance-requests/u123/file.jpg?token=abc";
  assert.deepEqual(parseStorageRefFromUrl(base, url), {
    bucket: "evidence",
    path: "finance-requests/u123/file.jpg",
  });
});

test("finance attachment extract: builds csv path next to attachment", () => {
  assert.equal(
    buildFinanceCsvPath("finance-requests/u123/file.jpg"),
    "finance-requests/u123/file.table.csv",
  );
  assert.equal(
    buildFinanceCsvPath("finance-requests/u123/file"),
    "finance-requests/u123/file.table.csv",
  );
});

test("finance attachment extract: builds ai json path next to attachment", () => {
  assert.equal(
    buildFinanceAiJsonPath("finance-requests/u123/file.jpg"),
    "finance-requests/u123/file.ai.json",
  );
  assert.equal(
    buildFinanceAiJsonPath("finance-requests/u123/file"),
    "finance-requests/u123/file.ai.json",
  );
});
