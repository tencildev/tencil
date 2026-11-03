# @tencildev/protocol

The wire protocol of [Tencil](https://tencil.dev): zod schemas for the messages
between the browser overlay and the bridge, the pin (`Thread`) and element context
types, and the `Provider` interface an agent backend implements.

```sh
npm install @tencildev/protocol
```

```ts
import { ClientMessage, type Provider } from '@tencildev/protocol';

const parsed = ClientMessage.safeParse(JSON.parse(raw));
if (parsed.success) console.log(parsed.data.type);
```

Providers only see text and images: the bridge (`@tencildev/bridge`) renders element
context into the prompt, so every provider gets the same input.

Pins can also carry comments among people (`role: 'comment'`, with an `author`), for
hosts that turn them on. A message mentioning `@tencil` hands the pin to the agent:
`mentionsOf` and `mentionsAgent` tell, also from `@tencildev/protocol/mentions`, which
leaves out zod for browser bundles.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
