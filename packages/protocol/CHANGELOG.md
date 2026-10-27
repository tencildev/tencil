# @tencildev/protocol

## 0.5.0

### Minor Changes

- [#13](https://github.com/tencildev/tencil/pull/13) [`f128982`](https://github.com/tencildev/tencil/commit/f12898249a42cbe715799e023d32b7dc505297ea) Thanks [@arjendevos](https://github.com/arjendevos)! - Providers can mark a thread they start for a pin `archivable` and implement `archive`
  and `reopen`. The bridge archives such a thread once all its pins are resolved or deleted, and
  reopens it when one is reopened or replied to.

## 0.4.0

### Minor Changes

- [#9](https://github.com/tencildev/tencil/pull/9) [`ca2b067`](https://github.com/tencildev/tencil/commit/ca2b067663d4ca552fd24d8bf48fbf5f41b29500) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Find a page's project from the repository the Vite plugin or `withTencil` runs in, so pages served by something other than a Node process in the project (Laravel on Sail or Herd, a backend behind a proxy) no longer ask "Which project is this page?". The loader passes the git root (`tencil.js?root=…`), the overlay sends it with `hello` (`root`), and the daemon uses it when it holds a `.git` folder or file, after the address's remembered choice and before the port lookup. In Next.js this needs `withTencil` in `next.config`. The plain `<script>` tag keeps the port lookup.

- [#10](https://github.com/tencildev/tencil/pull/10) [`f205605`](https://github.com/tencildev/tencil/commit/f2056058b7cb2fed6e3dd8571ace61aadd818c0e) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Updates: `ready` can carry an `UpdateStatus` (`update`), pushed again as an `update` message, and the overlay sends `update.start`. The bridge takes an `update` option for it; without one (Tencil Cloud) it leaves the field out and refuses `update.start`. `@tencildev/testing` adds `FakeRegistry`, a stand-in npm registry.

## 0.3.0

### Minor Changes

- [#6](https://github.com/tencildev/tencil/pull/6) [`25749e6`](https://github.com/tencildev/tencil/commit/25749e6d21588ab8a149525e2b957701f1a7c5a6) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Measure spacing in the overlay. While picking, the hovered element shows its padding, margin and flex or grid gap with their values (and the Tailwind class that sets them). Hold Alt to see the distances to its parent, or, with a comment open, to any other element; Alt-click to send those distances with the comment. With the ruler on, it also works outside comment mode: hold Alt (Option on a Mac) anywhere to measure, Alt-click to select an element to measure from, and press C to comment on it with that spacing. The ruler button in the toolbar, or `R`, turns this on (it starts off), and the project setting `ruler` (on by default) hides it altogether. Pins now carry the element's box model (`ElementContext.box`) and any measured spacing (`ElementContext.spacing`), and the bridge puts both in the prompt.

## 0.2.0

### Minor Changes

- [#21](https://github.com/tencildev/tencil/pull/21) [`1ead5ab`](https://github.com/tencildev/tencil/commit/1ead5ab4b67f611d25b83b3383a3a59391354ad0) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - What Tencil Cloud needs from the wire and the bridge. The protocol gains the build a cloud preview reports (`BuildInfo`), sign-in (`auth.required`, `CloudSignIn`, `Viewer`), a run's delivery (`Delivery`: queued, pushed, deploying, live) and its steps (`ThreadStep`), and `ThreadSink.delivery` and `ThreadSink.step`. The bridge stores and broadcasts delivery and steps on a provider thread's pins, starts a turn's steps afresh on a reply, and keeps page content from closing the prompt's context block.

## 0.1.0

### Minor Changes

- [#15](https://github.com/tencildev/tencil/pull/15) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First npm release of the packages behind Tencil's daemon: `@tencildev/protocol` (wire schemas and the `Provider` interface), `@tencildev/bridge` (pins, prompt rendering and provider wiring, with storage and provider creation injectable) and `@tencildev/testing` (a fake provider, a fake T3 Code server and a fake Claude Agent SDK).
