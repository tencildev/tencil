# @tencildev/testing

Test doubles for [Tencil](https://tencil.dev) and code built on its bridge.

```sh
npm install --save-dev @tencildev/testing
```

- **`FakeAgentProvider`**: a `Provider` that answers instantly and records every
  call. Push agent messages and status into a watched thread through `sinks`.
- **`FakeT3Server`**: a stand-in T3 Code server (auth endpoints and the RPC
  WebSocket) that simulates streamed agent turns.
- **`FakeAgentSdk`**: a stand-in for `@anthropic-ai/claude-agent-sdk`.
- **`waitFor`**: poll until a condition holds.

```ts
import { Bridge, MemoryThreadStore, ProjectProviders } from '@tencildev/bridge';
import { FakeAgentProvider } from '@tencildev/testing';

const provider = new FakeAgentProvider();
const bridge = new Bridge({
    providers: ProjectProviders.of(provider),
    store: new MemoryThreadStore(),
    project: { name: 'acme', root: '/acme' },
    version: '0',
});
```

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
