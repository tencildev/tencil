# Contributing to Tencil

Thanks for helping out. Bug reports, fixes and new providers are all welcome. For a
larger change, open an issue first so we can agree on the approach before you spend
time on it.

Security problems don't go in issues: see [SECURITY.md](SECURITY.md). Everyone taking
part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Node 22+ and pnpm (`corepack enable` picks the version from `package.json`).

```sh
pnpm install
pnpm build
```

[README.md](README.md#development) explains the layout, `pnpm dev` and how to try a
build in the playground app.

## Checks

Run these before you open a pull request; CI runs the same:

| Task | Command |
| --- | --- |
| Lint, typecheck, unit and integration tests | `pnpm check` |
| Browser tests (Playwright, real daemon + playground) | `pnpm test:e2e` |
| Format | `pnpm format` |

`pnpm check` runs on Linux, macOS and Windows in CI, so avoid shell-specific scripts
and hard-coded path separators. The browser tests need Chromium once:
`pnpm --filter playground exec playwright install chromium`.

## Conventions

The full list is in [AGENTS.md](AGENTS.md) (written for coding agents, useful for
people too). The short version:

- **Formatting and lint:** Biome with `biome-config-pixel` (4 spaces, single quotes).
  Run `pnpm format`.
- **Files and folders:** kebab-case (`thread-panel.tsx`, `project-resolver.ts`).
  Components are PascalCase exports in kebab-case files. One file per CLI command in
  `packages/tencil/src/cli/commands/`.
- **Imports:** relative within a package, the package name across packages
  (`@tencildev/protocol`).
- **Tests:** next to the code (`thread-store.test.ts`,
  `server.integration.test.ts`). New behaviour comes with a test; providers are
  tested against the fakes in `packages/testing`.
- **New files:** mirror the closest sibling in the same folder.
- **Overlay styles:** plain CSS in `packages/overlay/src/styles.ts`, no Tailwind.

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): subject`,
imperative and lowercase, e.g. `fix(daemon): refuse unknown host names`.

Scopes: `cli`, `daemon`, `init`, `overlay`, `t3code`, `claude-code`, `ensemble`, `protocol`,
`testing`, `playground`. Leave the scope out when none fits
(`docs: ...`, `ci: ...`).

## Changesets

If users of the `tencil` package will notice your change (a feature, a fix, a changed
flag or default), add a changeset:

```sh
pnpm changeset
```

Pick `tencil`, choose patch or minor, and write one or two sentences for the
changelog. Refactors, tests, docs and CI changes don't need one.

## Sign your commits (DCO)

Tencil uses the [Developer Certificate of Origin](https://developercertificate.org)
(DCO) instead of a contributor license agreement. By signing off a commit you state
that you wrote the change, or otherwise have the right to submit it under the
project's license (Apache-2.0). Read the full text at
[developercertificate.org](https://developercertificate.org).

Sign off by adding `-s` when you commit:

```sh
git commit -s -m "fix(overlay): keep the composer above the pin"
```

This adds a line with your name and email to the commit message:

```
Signed-off-by: Jane Doe <jane@example.com>
```

It must match the commit author. Every commit in a pull request needs it. Forgot?
Sign off the last commit with `git commit --amend -s --no-edit`, or all commits on
your branch with `git rebase --signoff master` (use the branch you started from),
then force-push.

## Pull requests

- Keep a pull request to one change; split unrelated fixes.
- Describe what changed and why, and how you tested it (the template asks).
- `pnpm check` passes, with tests for new behaviour. Run `pnpm test:e2e` when you
  touch the overlay, the daemon or the integrations.
- Add a changeset for user-visible changes.
- UI changes: add a screenshot or a short recording.
- Commits are signed off (DCO).

A maintainer reviews and merges. Releases are cut from `master` by the release
workflow; you don't need to bump versions.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), like the rest of the project.
