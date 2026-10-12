# Third-party notices

Tencil is licensed under the Apache License 2.0. The published `tencil` package
also contains code from the projects below, each used under the MIT License.

## Bundled

Compiled into `dist/overlay.global.js` (the browser overlay):

| Project | Version | Copyright | Used for |
| --- | --- | --- | --- |
| [Preact](https://github.com/preactjs/preact) | 11 | Copyright (c) 2015-present Jason Miller | Overlay UI |
| [@preact/signals](https://github.com/preactjs/signals) | 2 | Copyright (c) 2022-present Preact Team | Overlay state |
| [@preact/signals-core](https://github.com/preactjs/signals) | 1 | Copyright (c) 2022-present Preact Team | Overlay state (used by @preact/signals) |
| [bippy](https://github.com/aidenybai/bippy) | 0.7 | Copyright 2024-present Aiden Bai | React component and source lookup |
| [modern-screenshot](https://github.com/qq15725/modern-screenshot) | 4 | Copyright (c) 2021-present wxm | Element screenshots |
| [T3 Code](https://github.com/pingdotgg/t3code) | n/a | Copyright (c) 2026 T3 Tools Inc. | Agent icons (T3 Code, Codex, Claude, Cursor) shown in the thread list, from `apps/web/src/components/Icons.tsx` and `T3Wordmark.tsx` |

The product names and logos shown by those icons belong to their owners.

Each of these projects is distributed under the following license, with the
copyright line from the table above:

```
MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Dependencies

Installed next to `tencil` by npm, not bundled; each ships its own license:

| Project | License | Used for |
| --- | --- | --- |
| [ws](https://github.com/websockets/ws) | MIT | Bridge WebSocket server |
| [zod](https://github.com/colinhacks/zod) | MIT | Message validation |
| [picocolors](https://github.com/alexeyraspopov/picocolors) | ISC | CLI colors |

The [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
is an optional peer dependency. Tencil neither bundles nor ships it: it is loaded
from next to Tencil, or installed into Tencil's config folder on first use of the
Claude Code provider, under Anthropic's own terms.
