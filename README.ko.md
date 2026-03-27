<div align="center">
  <h1>claude-code-cache-read-circuit-breaker</h1>
  <p><strong>(Circuit Breaker) I used 100% in just 18 minutes? (Max plan)</strong></p>
  <p>
    <a href="https://github.com/dalsoop/claude-code-cache-read-circuit-breaker"><img src="https://img.shields.io/badge/github-dalsoop%2Fclaude--code--cache--read--circuit--breaker-181717?logo=github&logoColor=white" alt="GitHub repository"></a>
    <a href="https://github.com/dalsoop/claude-code-cache-read-circuit-breaker/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb.svg" alt="MIT License"></a>
  </p>
  <p><a href="./README.md">English</a></p>
</div>

번역기를 사용합니다.

![12 million tokens in 18 minutes](./assets/incident-2026-03-27-breakdown.svg)

2026년 3월 27일 22:00-22:18 KST 즈음 발생했습니다.

이전에는 이런 걸 겪어본 적이 없어서 별일 아니라고 생각했는데,
직접 맞아보니까 아니었습니다.

저기 보이는 1200만 토큰,
18분 만에 나간 겁니다.

에이전트를 돌릴 때 맞았습니다.
재귀적인 현상 같긴 한데, 이건 좀 심하다고 느꼈습니다.

그래서 단순한 hook를 만들었습니다.
사용량 제한을 걸고,
숫자는 취향대로 바꾸면 됩니다.

## 설치

```bash
claude plugin marketplace add dalsoop/claude-code-cache-read-circuit-breaker
claude plugin install claude-code-cache-read-circuit-breaker@dalsoop-plugins
```

## 삭제

```bash
claude plugin uninstall claude-code-cache-read-circuit-breaker
```

## 라이선스

MIT
