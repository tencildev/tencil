# @tencildev/bridge

The bridge behind [Tencil](https://tencil.dev): it owns a project's pins, renders
element context into the prompt and wires each pin to the agent (provider) that
works on it. The `tencil` daemon runs it on your machine; any other host can run
the same bridge with its own storage and providers.

```sh
npm install @tencildev/bridge
```

```ts
import { Bridge, MemoryThreadStore, ProjectProviders } from '@tencildev/bridge';

const bridge = new Bridge({
    // Your `Provider`s (see @tencildev/protocol); the first one is the default.
    providers: ProjectProviders.of([myProvider]),
    // Anything implementing `ThreadStore`; MemoryThreadStore keeps pins in memory.
    store: new MemoryThreadStore(),
    project: { name: 'acme', root: '/srv/acme' },
    version: '1.0.0',
});

// Per overlay connection: register it, then hand it every message it sends.
const client = { send: message => socket.send(JSON.stringify(message)) };
bridge.connect(client);
socket.on('message', data => bridge.handle(client, JSON.parse(String(data))));
```

- **`ThreadStore`**: a project's pins. Reads and writes are synchronous, so a store
  loads the project's pins before the bridge starts and persists changes behind
  the scenes; `flush()` resolves once they're saved.
- **`ProjectProviders`**: the providers a project can pick from, created on first
  use through your `create(id)`. Pass `settings` (a `ProjectSettingsStore`) to keep
  the project's picks (provider, model, batching); without it they live in memory.
- **`renderPrompt`, `stripContext`**: the prompt format agents receive, and the
  inverse used to show their messages.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
