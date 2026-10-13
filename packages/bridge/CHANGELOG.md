# @tencildev/bridge

## 0.2.0

### Minor Changes

- [#21](https://github.com/tencildev/tencil/pull/21) [`1ead5ab`](https://github.com/tencildev/tencil/commit/1ead5ab4b67f611d25b83b3383a3a59391354ad0) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - What Tencil Cloud needs from the wire and the bridge. The protocol gains the build a cloud preview reports (`BuildInfo`), sign-in (`auth.required`, `CloudSignIn`, `Viewer`), a run's delivery (`Delivery`: queued, pushed, deploying, live) and its steps (`ThreadStep`), and `ThreadSink.delivery` and `ThreadSink.step`. The bridge stores and broadcasts delivery and steps on a provider thread's pins, starts a turn's steps afresh on a reply, and keeps page content from closing the prompt's context block.

### Patch Changes

- Updated dependencies [[`1ead5ab`](https://github.com/tencildev/tencil/commit/1ead5ab4b67f611d25b83b3383a3a59391354ad0)]:
  - @tencildev/protocol@0.2.0

## 0.1.0

### Minor Changes

- [#15](https://github.com/tencildev/tencil/pull/15) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First npm release of the packages behind Tencil's daemon: `@tencildev/protocol` (wire schemas and the `Provider` interface), `@tencildev/bridge` (pins, prompt rendering and provider wiring, with storage and provider creation injectable) and `@tencildev/testing` (a fake provider, a fake T3 Code server and a fake Claude Agent SDK).

### Patch Changes

- Updated dependencies [[`de32e5f`](https://github.com/tencildev/tencil/commit/de32e5f59d5fe626af290350219c5a23ef340f59)]:
  - @tencildev/protocol@0.1.0
