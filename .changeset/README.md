# Changesets

Add one per user-facing change with `pnpm changeset`. Merging to `master` opens a
"Version packages" PR; merging that PR publishes `tencil`, `@tencil/protocol`,
`@tencil/bridge` and `@tencil/testing` to npm (every package that isn't private).
