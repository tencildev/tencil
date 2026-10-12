# Changesets

Add one per user-facing change with `pnpm changeset`. Merging to `master` opens a
"Version packages" PR; merging that PR publishes `tencil`, `@tencildev/protocol`,
`@tencildev/bridge` and `@tencildev/testing` to npm (every package that isn't private).
