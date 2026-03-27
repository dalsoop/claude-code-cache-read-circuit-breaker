# claude-code-cache-read-circuit-breaker

[한국어](./README.ko.md)

Using a translator.

I've never experienced this before, so I just assumed it was no big deal, but I ended up getting hit by it myself.

See those 12 million tokens over there?
That's what went out in 18 minutes.

It happened to me when I ran the agent.
It seems like a recursive phenomenon, but isn't this a bit much?

So I made a simple hook.
It sets a usage limit,
and you can just change the usage number to your liking.

![12 million tokens in 18 minutes](./assets/incident-2026-03-27-breakdown.svg)

## Install

```text
/plugin marketplace add dalsoop/claude-code-cache-read-circuit-breaker
/plugin install claude-code-cache-read-circuit-breaker@dalsoop-plugins
```

## Local Test

```bash
claude --plugin-dir /path/to/claude-code-cache-read-circuit-breaker
```

## License

MIT
