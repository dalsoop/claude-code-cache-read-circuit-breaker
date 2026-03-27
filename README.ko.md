<div align="center">
  <h1>claude-code-cache-read-circuit-breaker</h1>
  <p><strong>Claude Code를 사용하면 사용량이 뻥튀기되는 문제가 있다.</strong></p>
  <p><strong>나는 18분 만에 100%를 썼다. 이를 방지하기 위한 플러그인이다.</strong></p>
  <p>
    <a href="https://github.com/dalsoop/claude-code-cache-read-circuit-breaker"><img src="https://img.shields.io/badge/github-dalsoop%2Fclaude--code--cache--read--circuit--breaker-181717?logo=github&logoColor=white" alt="GitHub repository"></a>
    <a href="https://github.com/dalsoop/claude-code-cache-read-circuit-breaker/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb.svg" alt="MIT License"></a>
  </p>
  <p><a href="./README.md">English</a></p>
</div>

## Install

```bash
claude plugin marketplace add dalsoop/claude-code-cache-read-circuit-breaker
claude plugin install claude-code-cache-read-circuit-breaker@dalsoop-plugins
claude plugin enable claude-code-cache-read-circuit-breaker@dalsoop-plugins
```

> **주의:** `enable` 단계가 필수입니다. 이 단계 없이는 플러그인이 설치만 되고 hook이 실행되지 않습니다.

## Incident

2026년 3월 27일 22:00-22:18 KST 즈음 발생했습니다.

| 항목 | 값 |
| --- | --- |
| 요금제 | Max plan |
| 시간 구간 | 18분 |
| 보인 사용량 | 100% |
| 총합처럼 보인 사용량 | 12,183,667 |
| cache_read_input_tokens | 12,155,503 |
| 전체 비중 | 99.77% |

이전에는 이런 걸 겪어본 적이 없어서 별일 아니라고 생각했는데,
직접 맞아보니까 아니었습니다.

저기 보이는 1200만 토큰,
18분 만에 나간 겁니다.

에이전트를 돌릴 때 맞았습니다.
재귀적인 현상 같긴 한데, 이건 좀 심하다고 느꼈습니다.

그래서 단순한 hook를 만들었습니다.
사용량 제한을 걸고,
숫자는 취향대로 바꾸면 됩니다.

## 삭제

```bash
claude plugin uninstall claude-code-cache-read-circuit-breaker
```

## 라이선스

MIT
