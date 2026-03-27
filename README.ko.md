# claude-code-cache-read-circuit-breaker

[English](./README.md)

repeated `cache_read_input_tokens`를 막기 위한 Claude Code Circuit Breaker 입니다.

## 빠른 시작

Claude에서 설치:

```text
/plugin marketplace add dalsoop/claude-code-cache-read-circuit-breaker
/plugin install claude-code-cache-read-circuit-breaker@dalsoop-plugins
```

## 하는 일

- Claude 세션이 비대해졌을 때 프롬프트 차단
- 같은 세션이 이미 비대하면 tool 실행도 차단
- repeated `cache_read_input_tokens` 중심 감지

## 언제 동작하나

다음 경우 서킷브레이커가 동작합니다.

- 최근 `cache_read_input_tokens`가 너무 클 때
- 또는 세션 이벤트 수가 이미 너무 많을 때

threshold는 기호에 맞게 조절하면 됩니다.

## 실제 사건

이 레포를 만든 직접 원인은 fresh prompt input이 아니라 repeated `cache_read_input_tokens` 였습니다.

2026년 3월 27일, 하나의 Claude 세션이 한 시간에 12.18M 토큰을 쓴 것처럼 보이게 만들었습니다.

![March 27, 2026 token breakdown](./assets/incident-2026-03-27-breakdown.svg)

![March 27, 2026 repeated cache-read pattern](./assets/incident-2026-03-27-responses.svg)

해당 시간대 수치:

- `cache_read_input_tokens`: `12,155,503`
- `cache_creation_input_tokens`: `21,517`
- `output_tokens`: `6,597`
- `input_tokens`: `50`
- assistant 응답 수: `42`

## Plugin

이 레포에는 self-contained `UserPromptSubmit`, `PreToolUse` hook가 들어 있는 Claude plugin이 포함되어 있습니다.

로컬 테스트:

```bash
claude --plugin-dir /path/to/claude-code-cache-read-circuit-breaker
```

## 레포 메타데이터

추천 GitHub repo description:

```text
Claude Code Circuit Breaker for repeated cache_read_input_tokens in bloated sessions.
```

추천 release blurb:

```text
claude-code-cache-read-circuit-breaker is a Claude Code Circuit Breaker. It trips when repeated cache_read_input_tokens make a session look bloated.
```

## 라이선스

MIT
