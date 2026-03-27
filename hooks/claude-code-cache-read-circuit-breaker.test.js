const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const {
  analyzeTranscript,
  buildResponse,
  classify,
} = require("./claude-code-cache-read-circuit-breaker.js");

const base = path.join(__dirname, "..", "fixtures");
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

function runHookProcess(input) {
  const script = path.join(__dirname, "claude-code-cache-read-circuit-breaker.js");
  return childProcess.spawnSync(process.execPath, [script], {
    input,
    encoding: "utf8",
  });
}

function requireRunnableChildProcess() {
  const probe = childProcess.spawnSync(process.execPath, ["-e", "process.stdout.write('ok')"], {
    encoding: "utf8",
  });
  if (probe.error) {
    return `child_process spawn unavailable in this environment: ${probe.error.message}`;
  }
  if (probe.stdout !== "ok") {
    return "child_process spawn did not return the expected output";
  }
  return null;
}

test("classify returns HIGH for very large cache reads", () => {
  const [risk, reason] = classify(62_000, 2, 31_000, 10);
  assert.equal(risk, "HIGH");
  assert.match(reason, /50k/);
});

test("classify returns HIGH for many responses with large avg cache-read", () => {
  const [risk, reason] = classify(40_000, 5, 20_000, 10);
  assert.equal(risk, "HIGH");
  assert.match(reason, /many assistant/i);
});

test("classify returns HIGH for long session with elevated cache reads", () => {
  const [risk, reason] = classify(30_000, 3, 10_000, 100);
  assert.equal(risk, "HIGH");
  assert.match(reason, /long-lived/i);
});

test("classify returns WARN for large average cache-read even below hard block", () => {
  const [risk, reason] = classify(12_000, 1, 12_000, 10);
  assert.equal(risk, "WARN");
  assert.match(reason, /average cache-read/i);
});

test("classify returns WARN for elevated cache-read in window", () => {
  const [risk, reason] = classify(16_000, 2, 8_000, 10);
  assert.equal(risk, "WARN");
  assert.match(reason, /elevated/i);
});

test("classify returns WARN for long-lived session size alone", () => {
  const [risk, reason] = classify(5_000, 1, 5_000, 50);
  assert.equal(risk, "WARN");
  assert.match(reason, /history is already large/i);
});

test("classify returns OK just below all warning thresholds", () => {
  const [risk, reason] = classify(14_999, 1, 9_999, 49);
  assert.equal(risk, "OK");
  assert.match(reason, /no obvious session bloat/i);
});

test("analyzeTranscript flags high session fixture", () => {
  const result = analyzeTranscript(path.join(base, "session-high.jsonl"), "session-high", fixedNow);
  assert.equal(result.totalEventCount, 4);
  assert.equal(result.windowCacheRead, 62_000);
  assert.equal(result.windowAssistantCount, 2);
  assert.equal(result.avgCacheRead, 31_000);
  assert.equal(result.risk, "HIGH");
});

test("analyzeTranscript ignores malformed lines and old assistant events", () => {
  withTempTranscript([
    "{not-json",
    JSON.stringify({
      type: "assistant",
      sessionId: "session-filtered",
      timestamp: "2026-03-27T13:30:00Z",
      message: { usage: { cache_read_input_tokens: 900_000 } },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "session-filtered",
      timestamp: "2026-03-27T13:50:00Z",
      message: { usage: { cache_read_input_tokens: 8_000 } },
    }),
  ], (file) => {
    const result = analyzeTranscript(file, "session-filtered", fixedNow);
    assert.equal(result.totalEventCount, 2);
    assert.equal(result.windowAssistantCount, 1);
    assert.equal(result.windowCacheRead, 8_000);
    assert.equal(result.risk, "OK");
  });
});

test("analyzeTranscript honors session filtering inside a mixed transcript", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      sessionId: "session-a",
      timestamp: "2026-03-27T13:50:00Z",
      message: { usage: { cache_read_input_tokens: 40_000 } },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "session-b",
      timestamp: "2026-03-27T13:52:00Z",
      message: { usage: { cache_read_input_tokens: 3_000 } },
    }),
  ], (file) => {
    const result = analyzeTranscript(file, "session-b", fixedNow);
    assert.equal(result.totalEventCount, 1);
    assert.equal(result.windowAssistantCount, 1);
    assert.equal(result.windowCacheRead, 3_000);
    assert.equal(result.risk, "OK");
  });
});

test("analyzeTranscript falls back to transcript filename when sessionId is missing", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-27T13:52:00Z",
      message: { usage: { cache_read_input_tokens: 4_000 } },
    }),
  ], (file) => {
    const namedFile = path.join(path.dirname(file), "fallback-session.jsonl");
    fs.renameSync(file, namedFile);
    const result = analyzeTranscript(namedFile, "fallback-session", fixedNow);
    assert.equal(result.totalEventCount, 1);
    assert.equal(result.windowAssistantCount, 1);
    assert.equal(result.windowCacheRead, 4_000);
  });
});

test("analyzeTranscript treats missing usage as zero without crashing", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      sessionId: "session-zero",
      timestamp: "2026-03-27T13:52:00Z",
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

test("analyzeTranscript returns OK for an empty transcript", () => {
  withTempTranscript([], (file) => {
    const result = analyzeTranscript(file, "empty-session", fixedNow);
    assert.equal(result.totalEventCount, 0);
    assert.equal(result.windowAssistantCount, 0);
    assert.equal(result.windowCacheRead, 0);
    assert.equal(result.risk, "OK");
  });
});

test("analyzeTranscript returns OK when session filter matches nothing", () => {
  const result = analyzeTranscript(path.join(base, "session-high.jsonl"), "nope", fixedNow);
  assert.equal(result.totalEventCount, 0);
  assert.equal(result.windowAssistantCount, 0);
  assert.equal(result.windowCacheRead, 0);
  assert.equal(result.risk, "OK");
});

test("buildResponse blocks a bloated session", () => {
  const response = buildResponse({
    session_id: "session-high",
    transcript_path: path.join(base, "session-high.jsonl"),
  }, fixedNow);

  assert.equal(response.continue, false);
  assert.match(response.stopReason, /looks bloated/);
  assert.match(response.systemMessage, /50k/);
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

test("main() emits a pass-through response for invalid stdin JSON", () => {
  const skipReason = requireRunnableChildProcess();
  if (skipReason) return test.skip(skipReason);

  const result = runHookProcess("{not-json");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.continue, true);
  assert.match(parsed.systemMessage, /invalid json input/i);
});

test("main() emits a block response for a bloated session payload", () => {
  const skipReason = requireRunnableChildProcess();
  if (skipReason) return test.skip(skipReason);

  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      sessionId: "session-block",
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      message: { usage: { cache_read_input_tokens: 60_000 } },
    }),
  ], (file) => {
    const result = runHookProcess(JSON.stringify({
      session_id: "session-block",
      transcript_path: file,
    }));

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.continue, false);
    assert.match(parsed.stopReason, /looks bloated/);
  });
});

test("main() emits a quiet response when transcript_path is missing", () => {
  const skipReason = requireRunnableChildProcess();
  if (skipReason) return test.skip(skipReason);

  const result = runHookProcess(JSON.stringify({
    session_id: "session-ok",
    hook_event_name: "UserPromptSubmit",
  }));

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");

  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed, {
    continue: true,
    suppressOutput: true,
  });
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

test("buildResponse ignores unknown payload fields", () => {
  const response = buildResponse({
    hook_event_name: "UserPromptSubmit",
    session_id: "session-ok",
    transcript_path: path.join(base, "session-ok.jsonl"),
    random_field: { anything: true },
  }, fixedNow);

  assert.equal(response.continue, true);
  assert.equal(response.systemMessage, undefined);
});

test("buildResponse blocks at the exact cache-read threshold", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      sessionId: "session-threshold",
      timestamp: "2026-03-27T13:52:00Z",
      message: { usage: { cache_read_input_tokens: 50_000 } },
    }),
  ], (file) => {
    const response = buildResponse({
      session_id: "session-threshold",
      transcript_path: file,
    }, fixedNow);

    assert.equal(response.continue, false);
    assert.match(response.systemMessage, /50k/);
  });
});

test("buildResponse warns for a long session before hard blocking", () => {
  const lines = [];
  for (let i = 0; i < 50; i += 1) {
    lines.push(JSON.stringify({
      type: "user",
      sessionId: "session-long",
      timestamp: "2026-03-27T13:50:00Z",
    }));
  }
  lines.push(JSON.stringify({
    type: "assistant",
    sessionId: "session-long",
    timestamp: "2026-03-27T13:55:00Z",
    message: { usage: { cache_read_input_tokens: 5_000 } },
  }));

  withTempTranscript(lines, (file) => {
    const response = buildResponse({
      session_id: "session-long",
      transcript_path: file,
    }, fixedNow);

    assert.equal(response.continue, true);
    assert.match(response.systemMessage, /warning/i);
    assert.match(response.systemMessage, /51 events/);
  });
});

test("buildResponse blocks at max-events threshold because session size alone is a warning signal", () => {
  const lines = [];
  for (let i = 0; i < 100; i += 1) {
    lines.push(JSON.stringify({
      type: "user",
      sessionId: "session-ok-events",
      timestamp: "2026-03-27T13:50:00Z",
    }));
  }

  withTempTranscript(lines, (file) => {
    const response = buildResponse({
      session_id: "session-ok-events",
      transcript_path: file,
    }, fixedNow);

    assert.equal(response.continue, false);
    assert.match(response.systemMessage, /history is already large/i);
    assert.match(response.stopReason, /100 events/);
  });
});

test("buildResponse uses block over warning when both conditions are true", () => {
  const lines = [];
  for (let i = 0; i < 100; i += 1) {
    lines.push(JSON.stringify({
      type: "user",
      sessionId: "session-precedence",
      timestamp: "2026-03-27T13:50:00Z",
    }));
  }
  lines.push(JSON.stringify({
    type: "assistant",
    sessionId: "session-precedence",
    timestamp: "2026-03-27T13:55:00Z",
    message: { usage: { cache_read_input_tokens: 55_000 } },
  }));

  withTempTranscript(lines, (file) => {
    const response = buildResponse({
      hook_event_name: "PreToolUse",
      session_id: "session-precedence",
      transcript_path: file,
    }, fixedNow);

    assert.equal(response.continue, false);
    assert.match(response.stopReason, /looks bloated/);
    assert.doesNotMatch(response.stopReason, /warning/i);
  });
});

test("buildResponse truncates long session ids in block messages", () => {
  withTempTranscript([
    JSON.stringify({
      type: "assistant",
      sessionId: "1234567890abcdef",
      timestamp: "2026-03-27T13:52:00Z",
      message: { usage: { cache_read_input_tokens: 50_000 } },
    }),
  ], (file) => {
    const response = buildResponse({
      session_id: "1234567890abcdef",
      transcript_path: file,
    }, fixedNow);

    assert.equal(response.continue, false);
    assert.match(response.stopReason, /1234567890ab\.\.\./);
  });
});

test("buildResponse blocks when non-OK risk combines with total events threshold", () => {
  const lines = [];
  for (let i = 0; i < 100; i += 1) {
    lines.push(JSON.stringify({
      type: "user",
      sessionId: "session-hard-events",
      timestamp: "2026-03-27T13:50:00Z",
    }));
  }
  lines.push(JSON.stringify({
    type: "assistant",
    sessionId: "session-hard-events",
    timestamp: "2026-03-27T13:55:00Z",
    message: { usage: { cache_read_input_tokens: 16_000 } },
  }));

  withTempTranscript(lines, (file) => {
    const response = buildResponse({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      session_id: "session-hard-events",
      transcript_path: file,
    }, fixedNow);

    assert.equal(response.continue, false);
    assert.match(response.stopReason, /101 events/);
    assert.match(response.systemMessage, /elevated|large/i);
  });
});
