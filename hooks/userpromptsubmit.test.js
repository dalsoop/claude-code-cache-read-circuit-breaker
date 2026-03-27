const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  analyzeTranscript,
  buildResponse,
  classify,
} = require("./userpromptsubmit.js");

const base = path.join(__dirname, "..", "testdata", "claude-projects", "demo");
const fixedNow = Date.parse("2026-03-27T14:00:00Z");

test("classify returns HIGH for very large cache reads", () => {
  const [risk, reason] = classify(1_240_000, 2, 620_000, 10);
  assert.equal(risk, "HIGH");
  assert.match(reason, /1M/);
});

test("analyzeTranscript flags high session fixture", () => {
  const result = analyzeTranscript(path.join(base, "session-high.jsonl"), "session-high");
  assert.equal(result.totalEventCount, 4);
  assert.equal(result.windowCacheRead >= 0, true);
  assert.equal(result.windowAssistantCount >= 0, true);
});

test("buildResponse blocks a bloated session", () => {
  const response = buildResponse({
    session_id: "session-high",
    transcript_path: path.join(base, "session-high.jsonl"),
  }, fixedNow);

  assert.equal(response.continue, false);
  assert.match(response.stopReason, /looks bloated/);
  assert.match(response.systemMessage, /1M/);
});

test("buildResponse warns on elevated but not blocking cache reads", () => {
  const response = buildResponse({
    session_id: "session-warn",
    transcript_path: path.join(base, "session-warn.jsonl"),
  }, fixedNow);

  assert.equal(response.continue, true);
  assert.match(response.systemMessage, /warning/i);
});

test("buildResponse allows healthy session", () => {
  const response = buildResponse({
    session_id: "session-ok",
    transcript_path: path.join(base, "session-ok.jsonl"),
  }, fixedNow);

  assert.equal(response.continue, true);
  assert.equal(response.systemMessage, undefined);
});

test("buildResponse tolerates invalid payload", () => {
  const response = buildResponse(null, fixedNow);
  assert.equal(response.continue, true);
  assert.match(response.systemMessage, /invalid json input/i);
});

test("buildResponse reports transcript read failure", () => {
  const response = buildResponse({
    session_id: "missing",
    transcript_path: path.join(base, "missing.jsonl"),
  }, fixedNow);

  assert.equal(response.continue, true);
  assert.match(response.systemMessage, /could not inspect/i);
});
