#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const WINDOW_MS = 60 * 60 * 1000;
const MAX_CACHE_READ = 1_000_000;
const MAX_EVENTS = 1000;

function parseTimestamp(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return ts;
}

function classify(windowCacheRead, windowAssistantCount, avgCacheRead, totalEventCount) {
  if (windowCacheRead >= 1_000_000) {
    return ["HIGH", "cache-read tokens exceeded 1M in the selected window"];
  }
  if (windowAssistantCount >= 20 && avgCacheRead >= 100_000) {
    return ["HIGH", "many assistant responses reused a very large cached context"];
  }
  if (totalEventCount >= 1_000 && windowCacheRead >= 500_000) {
    return ["HIGH", "a very long-lived session is still driving heavy cache re-reads"];
  }
  if (windowCacheRead >= 100_000) {
    return ["WARN", "cache-read tokens are elevated in the selected window"];
  }
  if (avgCacheRead >= 50_000) {
    return ["WARN", "average cache-read per assistant response is high"];
  }
  if (totalEventCount >= 500) {
    return ["WARN", "session history is already large enough to deserve rotation"];
  }
  return ["OK", "no obvious session bloat signal was detected"];
}

function analyzeTranscript(transcriptPath, sessionId) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  let totalEventCount = 0;
  let windowAssistantCount = 0;
  let windowCacheRead = 0;

  const content = fs.readFileSync(transcriptPath, "utf8");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const entrySession =
      entry.sessionId || path.basename(transcriptPath, path.extname(transcriptPath));
    if (sessionId && entrySession !== sessionId) continue;

    totalEventCount += 1;
    if (entry.type !== "assistant") continue;

    const ts = parseTimestamp(entry.timestamp);
    if (ts === null || ts < windowStart) continue;

    const usage = (entry.message && entry.message.usage) || {};
    windowAssistantCount += 1;
    windowCacheRead += Number(usage.cache_read_input_tokens || 0);
  }

  const avgCacheRead =
    windowAssistantCount > 0 ? Math.floor(windowCacheRead / windowAssistantCount) : 0;
  const [risk, reason] = classify(
    windowCacheRead,
    windowAssistantCount,
    avgCacheRead,
    totalEventCount,
  );
  return {
    risk,
    reason,
    windowCacheRead,
    windowAssistantCount,
    avgCacheRead,
    totalEventCount,
  };
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function buildResponse(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object") {
    return {
      continue: true,
      suppressOutput: true,
      systemMessage: "save-my-claude-token hook received invalid JSON input",
    };
  }

  const transcriptPath = payload.transcript_path;
  const sessionId = payload.session_id;
  const response = {
    continue: true,
    suppressOutput: true,
  };

  if (!transcriptPath) {
    emit(response);
    return;
  }

  let result;
  try {
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      result = analyzeTranscript(transcriptPath, sessionId);
    } finally {
      Date.now = originalNow;
    }
  } catch (error) {
    return {
      ...response,
      systemMessage: `save-my-claude-token hook could not inspect the current transcript: ${error.message}`,
    };
  }

  const shortId =
    sessionId && sessionId.length > 12 ? `${sessionId.slice(0, 12)}...` : sessionId || "current";

  if (
    result.windowCacheRead >= MAX_CACHE_READ ||
    (result.risk !== "OK" && result.totalEventCount >= MAX_EVENTS)
  ) {
    return {
      continue: false,
      suppressOutput: true,
      stopReason:
        `Blocked by save-my-claude-token: session ${shortId} looks bloated ` +
        `(${result.windowCacheRead} cache-read tokens in the last hour, ${result.totalEventCount} events). ` +
        "Start a fresh Claude session.",
      systemMessage: result.reason,
    };
  }

  if (result.risk === "WARN") {
    return {
      ...response,
      systemMessage:
        `save-my-claude-token warning: session ${shortId} is growing ` +
        `(${result.windowCacheRead} cache-read tokens in the last hour, ${result.totalEventCount} events). ` +
        "Consider rotating it soon.",
    };
  }

  return response;
}

async function main() {
  let payload;
  try {
    const raw = fs.readFileSync(0, "utf8");
    payload = JSON.parse(raw);
  } catch {
    emit(buildResponse(null));
    return;
  }

  emit(buildResponse(payload));
}

module.exports = {
  WINDOW_MS,
  MAX_CACHE_READ,
  MAX_EVENTS,
  parseTimestamp,
  classify,
  analyzeTranscript,
  buildResponse,
};

if (require.main === module) {
  main();
}
