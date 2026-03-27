const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  analyzeTranscript,
  buildResponse,
  classify,
} = require("./claude-code-cache-read-circuit-breaker.js");

const base = path.join(__dirname, "..", "testdata", "claude-projects", "demo");
const fixedNow = Date.parse("2026-03-27T14:00:00Z");

function withTempTranscript(lines, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cccrc-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("classify returns HIGH for very large cache reads", () => {
  const [risk, reason] = classify(1_240_000, 2, 620_000, 10);
  assert.equal(risk, "HIGH");
  assert.match(reason, /1M/);
});

test("classify returns WARN for large average cache-read even below hard block", () => {
  const [risk, reason] = classify(80_000, 2, 55_000, 10);
  assert.equal(risk, "WARN");
  assert.match(reason, /average cache-read/i);
});

test("classify returns WARN for long-lived session size alone", () => {
  const [risk, reason] = classify(5_000, 1, 5_000, 500);
  assert.equal(risk, "WARN");
  assert.match(reason, /history is already large/i);
});

test("analyzeTranscript flags high session fixture", () => {
  const result = analyzeTranscript(path.join(base, "session-high.jsonl"), "session-high", fixedNow);
  assert.equal(result.totalEventCount, 4);
  assert.equal(result.windowCacheRead, 1_240_000);
  assert.equal(result.windowAssistantCount, 2);
  assert.equal(result.avgCacheRead, 620_000);
  assert.equal(result.risk, "HIGH");
});

test("analyzeTranscript ignores malformed lines and old assistant events", () => {
  withTempTranscript([
    "{not-json",
    JSON.stringify({
      type: "assistant",
      sessionId: "session-filtered",
      timestamp: "2026-03-27T11:30:00Z",
      message: { usage: { cache_read_input_tokens: 900_000 } },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "session-filtered",
      timestamp: "2026-03-27T13:30:00Z",
      message: { usage: { cache_read_input_tokens: 10_000 } },
    }),
  ], (file) => {
    const result = analyzeTranscript(file, "session-filtered", fixedNow);
    assert.equal(result.totalEventCount, 2);
    assert.equal(result.windowAssistantCount, 1);
    assert.equal(result.windowCacheRead, 10_000);
    assert.equal(result.risk, "OK");
  });
});

test("analyzeTranscript honors session filtering inside a mixed transcript", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      sessionId: "session-a",
      timestamp: "2026-03-27T13:10:00Z",
      message: { usage: { cache_read_input_tokens: 750_000 } },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "session-b",
      timestamp: "2026-03-27T13:20:00Z",
      message: { usage: { cache_read_input_tokens: 15_000 } },
    }),
  ], (file) => {
    const result = analyzeTranscript(file, "session-b", fixedNow);
    assert.equal(result.totalEventCount, 1);
    assert.equal(result.windowAssistantCount, 1);
    assert.equal(result.windowCacheRead, 15_000);
    assert.equal(result.risk, "OK");
  });
});

test("analyzeTranscript falls back to transcript filename when sessionId is missing", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-27T13:20:00Z",
      message: { usage: { cache_read_input_tokens: 25_000 } },
    }),
  ], (file) => {
    const namedFile = path.join(path.dirname(file), "fallback-session.jsonl");
    fs.renameSync(file, namedFile);
    const result = analyzeTranscript(namedFile, "fallback-session", fixedNow);
    assert.equal(result.totalEventCount, 1);
    assert.equal(result.windowAssistantCount, 1);
    assert.equal(result.windowCacheRead, 25_000);
  });
});

test("analyzeTranscript treats missing usage as zero without crashing", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      sessionId: "session-zero",
      timestamp: "2026-03-27T13:20:00Z",
      message: {},
    }),
  ], (file) => {
    const result = analyzeTranscript(file, "session-zero", fixedNow);
    assert.equal(result.totalEventCount, 1);
    assert.equal(result.windowAssistantCount, 1);
    assert.equal(result.windowCacheRead, 0);
    assert.equal(result.risk, "OK");
  });
});

test("analyzeTranscript skips assistant entries with invalid timestamps", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      sessionId: "session-bad-ts",
      timestamp: "not-a-timestamp",
      message: { usage: { cache_read_input_tokens: 999_999 } },
    }),
  ], (file) => {
    const result = analyzeTranscript(file, "session-bad-ts", fixedNow);
    assert.equal(result.totalEventCount, 1);
    assert.equal(result.windowAssistantCount, 0);
    assert.equal(result.windowCacheRead, 0);
    assert.equal(result.risk, "OK");
  });
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

test("buildResponse returns a quiet pass-through response when transcript_path is missing", () => {
  const response = buildResponse({
    session_id: "session-ok",
  }, fixedNow);

  assert.deepEqual(response, {
    continue: true,
    suppressOutput: true,
  });
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

test("buildResponse tolerates PreToolUse-style payloads", () => {
  const response = buildResponse({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    session_id: "session-ok",
    transcript_path: path.join(base, "session-ok.jsonl"),
  }, fixedNow);

  assert.equal(response.continue, true);
  assert.equal(response.systemMessage, undefined);
});

test("buildResponse blocks at the exact cache-read threshold", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      sessionId: "session-threshold",
      timestamp: "2026-03-27T13:20:00Z",
      message: { usage: { cache_read_input_tokens: 1_000_000 } },
    }),
  ], (file) => {
    const response = buildResponse({
      session_id: "session-threshold",
      transcript_path: file,
    }, fixedNow);

    assert.equal(response.continue, false);
    assert.match(response.systemMessage, /1M/);
  });
});

test("buildResponse warns for a long session before hard blocking", () => {
  const lines = [];
  for (let i = 0; i < 500; i += 1) {
    lines.push(JSON.stringify({
      type: "user",
      sessionId: "session-long",
      timestamp: "2026-03-27T13:00:00Z",
    }));
  }
  lines.push(JSON.stringify({
    type: "assistant",
    sessionId: "session-long",
    timestamp: "2026-03-27T13:30:00Z",
    message: { usage: { cache_read_input_tokens: 20_000 } },
  }));

  withTempTranscript(lines, (file) => {
    const response = buildResponse({
      session_id: "session-long",
      transcript_path: file,
    }, fixedNow);

    assert.equal(response.continue, true);
    assert.match(response.systemMessage, /warning/i);
    assert.match(response.systemMessage, /501 events/);
  });
});

test("buildResponse blocks when non-OK risk combines with total events threshold", () => {
  const lines = [];
  for (let i = 0; i < 1000; i += 1) {
    lines.push(JSON.stringify({
      type: "user",
      sessionId: "session-hard-events",
      timestamp: "2026-03-27T13:00:00Z",
    }));
  }
  lines.push(JSON.stringify({
    type: "assistant",
    sessionId: "session-hard-events",
    timestamp: "2026-03-27T13:30:00Z",
    message: { usage: { cache_read_input_tokens: 120_000 } },
  }));

  withTempTranscript(lines, (file) => {
    const response = buildResponse({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      session_id: "session-hard-events",
      transcript_path: file,
    }, fixedNow);

    assert.equal(response.continue, false);
    assert.match(response.stopReason, /1001 events/);
    assert.match(response.systemMessage, /elevated|large/i);
  });
});
