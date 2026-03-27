# claude-code-cache-read-circuit-breaker

[한국어](./README.ko.md)

Claude Code Circuit Breaker for repeated `cache_read_input_tokens`.

## Quick Start

Install in Claude:

```text
/plugin marketplace add dalsoop/claude-code-cache-read-circuit-breaker
/plugin install claude-code-cache-read-circuit-breaker@dalsoop-plugins
```

## What It Does

- blocks prompts when a Claude session looks bloated
- blocks tool execution when the same session already looks bloated
- focuses on repeated `cache_read_input_tokens`

## When It Trips

It trips when:

- recent `cache_read_input_tokens` is too high
- or the session event count is already too large

Tune the thresholds to your own tolerance.

## Incident

The problem that triggered this repo was not fresh prompt input. It was repeated `cache_read_input_tokens`.

On March 27, 2026, one Claude session made usage look like 12.18M tokens in a single hour.

![March 27, 2026 token breakdown](./assets/incident-2026-03-27-breakdown.svg)

![March 27, 2026 repeated cache-read pattern](./assets/incident-2026-03-27-responses.svg)

Window totals:

- `cache_read_input_tokens`: `12,155,503`
- `cache_creation_input_tokens`: `21,517`
- `output_tokens`: `6,597`
- `input_tokens`: `50`
- assistant responses: `42`

## Plugin

This repository includes a Claude plugin with self-contained `UserPromptSubmit` and `PreToolUse` hooks.

Local test:

```bash
claude --plugin-dir /path/to/claude-code-cache-read-circuit-breaker
```

## Repo Metadata

Suggested GitHub repo description:

```text
Claude Code Circuit Breaker for repeated cache_read_input_tokens in bloated sessions.
```

Suggested release blurb:

```text
claude-code-cache-read-circuit-breaker is a Claude Code Circuit Breaker. It trips when repeated cache_read_input_tokens make a session look bloated.
```

## License

MIT
