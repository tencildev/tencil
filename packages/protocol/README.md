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

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
