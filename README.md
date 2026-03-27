<div align="center">
  <h1>claude-code-cache-read-circuit-breaker</h1>
  <p><strong>Claude Code can inflate usage.</strong></p>
  <p><strong>I used 100% in just 18 minutes. This plugin is meant to prevent that.</strong></p>
  <p>
    <a href="https://github.com/dalsoop/claude-code-cache-read-circuit-breaker"><img src="https://img.shields.io/badge/github-dalsoop%2Fclaude--code--cache--read--circuit--breaker-181717?logo=github&logoColor=white" alt="GitHub repository"></a>
    <a href="https://github.com/dalsoop/claude-code-cache-read-circuit-breaker/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb.svg" alt="MIT License"></a>
  </p>
  <p><a href="./README.ko.md">한국어</a></p>
</div>

Install

```bash
claude plugin marketplace add dalsoop/claude-code-cache-read-circuit-breaker
claude plugin install claude-code-cache-read-circuit-breaker@dalsoop-plugins
```

![12 million tokens in 18 minutes](./assets/incident-2026-03-27-breakdown.svg)

Happened on March 27, 2026, around 22:00-22:18 KST.

I've never experienced this before, so I just assumed it was no big deal, but I ended up getting hit by it myself.

See those 12 million tokens over there?
That's what went out in 18 minutes.

It happened to me when I ran the agent.
It seems like a recursive phenomenon, but isn't this a bit much?

So I made a simple hook.
It sets a usage limit,
and you can just change the usage number to your liking.

## Uninstall

```bash
claude plugin uninstall claude-code-cache-read-circuit-breaker
```

## License

MIT
