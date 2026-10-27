# @tencildev/testing

## 0.3.0

### Minor Changes

- [#14](https://github.com/tencildev/tencil/pull/14) [`8491e40`](https://github.com/tencildev/tencil/commit/8491e4036f2fe7020d26d00df7b0a59b66630c99) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Add Ensemble as an agent provider through its public local API. Keep the Ensemble
  app running and allow Tencil once when pairing. Pages map to Ensemble threads by
  dev server port, including forwarded ports; each pin creates a separate chat on
  the same checkout. Pages served from an Ensemble project's own folder start a new
  thread per pin, archived when the pin is resolved and reopened with it. Stream messages and tool steps over a shared, resumable feed.

### Patch Changes

- Updated dependencies [[`f128982`](https://github.com/tencildev/tencil/commit/f12898249a42cbe715799e023d32b7dc505297ea)]:
  - @tencildev/protocol@0.5.0

## 0.2.0

### Minor Changes

- [#10](https://github.com/tencildev/tencil/pull/10) [`f205605`](https://github.com/tencildev/tencil/commit/f2056058b7cb2fed6e3dd8571ace61aadd818c0e) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - Updates: `ready` can carry an `UpdateStatus` (`update`), pushed again as an `update` message, and the overlay sends `update.start`. The bridge takes an `update` option for it; without one (Tencil Cloud) it leaves the field out and refuses `update.start`. `@tencildev/testing` adds `FakeRegistry`, a stand-in npm registry.

### Patch Changes

- Updated dependencies [[`ca2b067`](https://github.com/tencildev/tencil/commit/ca2b067663d4ca552fd24d8bf48fbf5f41b29500), [`f205605`](https://github.com/tencildev/tencil/commit/f2056058b7cb2fed6e3dd8571ace61aadd818c0e)]:
  - @tencildev/protocol@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`25749e6`](https://github.com/tencildev/tencil/commit/25749e6d21588ab8a149525e2b957701f1a7c5a6)]:
  - @tencildev/protocol@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`1ead5ab`](https://github.com/tencildev/tencil/commit/1ead5ab4b67f611d25b83b3383a3a59391354ad0)]:
  - @tencildev/protocol@0.2.0

## 0.1.0

### Minor Changes

- [#15](https://github.com/tencildev/tencil/pull/15) Thanks [@Willem-Jaap](https://github.com/Willem-Jaap)! - First npm release of the packages behind Tencil's daemon: `@tencildev/protocol` (wire schemas and the `Provider` interface), `@tencildev/bridge` (pins, prompt rendering and provider wiring, with storage and provider creation injectable) and `@tencildev/testing` (a fake provider, a fake T3 Code server and a fake Claude Agent SDK).

### Patch Changes

- Updated dependencies [[`de32e5f`](https://github.com/tencildev/tencil/commit/de32e5f59d5fe626af290350219c5a23ef340f59)]:
  - @tencildev/protocol@0.1.0
