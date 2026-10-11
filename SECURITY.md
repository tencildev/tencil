# Security policy

<!-- Maintainers: security@tencil.dev must exist and reach you before this file is public. -->

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue or pull request:

- **GitHub:** [report a vulnerability](https://github.com/pixel-perfect-agency/tencil/security/advisories/new)
  (Security tab → "Report a vulnerability"). This is the preferred route.
- **Email:** [security@tencil.dev](mailto:security@tencil.dev).

Include what you found, the Tencil version (`npx tencil --version`), your OS and
browser, and the steps or a proof of concept to reproduce it. We'll confirm receipt
within a few working days, keep you posted while we fix it, and credit you in the
advisory unless you'd rather not be named.

## Supported versions

Fixes go into the latest release of the [`tencil`](https://www.npmjs.com/package/tencil)
package. Please check that the problem still exists there before reporting.

## Scope

Tencil drives a coding agent that can edit files and run commands on the developer's
machine, so anything that lets someone other than the developer reach it matters.
Setup runs one daemon per machine, listening on `127.0.0.1:4747`. It serves the
overlay script (`/tencil.js`) and a WebSocket bridge that creates agent threads and
sends them prompts.

In scope, for example:

- A web page that isn't the developer's local dev site getting the daemon to start
  or steer an agent, read pins or threads, or read credentials: bypassing the Origin
  check, the Host check (DNS rebinding) or the loopback-only rule for clients
  without an Origin. These checks live in
  [`packages/tencil/src/daemon/security.ts`](packages/tencil/src/daemon/security.ts).
- Agent replies or page content that run as script in the overlay (it renders agent
  output as text).
- Credentials (`~/.config/tencil/credentials.json`, T3 Code pairing tokens) leaking
  to the page, to logs or to other users on the machine.
- `tencil init` or `tencil setup` writing outside the project or the Tencil config
  folder, or the login service running something other than Tencil.

Out of scope:

- What the agent does with a prompt the developer sent it. Tencil passes prompts on;
  the agent's own permission mode (`--runtime-mode`, `full-access` by default)
  decides what it may do.
- Exposure the developer opted into: `--listen` on a network address or
  `--allow-origin` for another origin. The CLI documents that these widen access.
- Vulnerabilities in T3 Code, Claude Code or the Claude Agent SDK themselves; report
  those to their maintainers.
