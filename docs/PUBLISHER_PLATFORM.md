# Publisher Platform Boundary

Canyon Charms keeps game rules and rendering independent from publisher services. Game-facing code consumes one `PublisherPlatform` interface; standalone, Arkadium Sandbox, Arkadium DEV, and Arkadium PROD provide different adapters behind that interface.

## Source of truth

The contract semantics mirror `646826/arkadium-game-factory/packages/platform-contract`:

- the same capability names;
- the same lifecycle states;
- the same error-code vocabulary;
- the same `recoverable` error flag;
- the same persistence, analytics, ads, wallet, and leaderboard method shapes.

A later deterministic snapshot step records the exact factory commit and hashes. This package provides a browser-runnable JavaScript boundary now so independently useful work can remain in `main` while the reviewed official adapter is imported.

## Standalone adapter

`createStandalonePublisherPlatform()` is a real local adapter, not an Arkadium mock. It deliberately advertises every publisher capability as unavailable and implements the lifecycle contract without loading a publisher SDK.

Lifecycle order is strict:

```text
new -> initialized -> ready -> started -> ended -> destroyed
```

Score and level operations are valid only while the lifecycle is `started`. Unsupported service calls return `UNSUPPORTED_CAPABILITY`; they do not report synthetic ad success, fake wallet balances, fake saves, or fake leaderboard submissions.

## Host pause and resume

The adapter accepts an optional event source and fans host pause/resume notifications out to subscribers. The production adapter contains no test-only emit methods. Tests use `standalone-harness.js`, which injects a deterministic event source from outside the platform object.

## Failure policy

Errors are stable structured results:

```js
{
  ok: false,
  error: {
    code: 'UNSUPPORTED_CAPABILITY',
    message: 'Capability wallet is unavailable.',
    recoverable: true,
  },
}
```

Publisher mode implementations must redact upstream SDK payloads. They may not silently downgrade to standalone behavior after an Arkadium initialization failure.
