---
'tencil': minor
'@tencildev/protocol': minor
'@tencildev/bridge': minor
---

Commit or revert an agent's change from its pin. Turn on Git actions in a project's Tools
settings, and once an agent has changed files its pin shows Commit and Revert. Commit asks
the agent to commit its edits, so your repository's agent instructions, commit conventions
and hooks apply, and shows the commit once it's made. Revert undoes the agent's edits in
your files and keeps everything else, even other edits in the same files. A follow-up on the
pin adds to the same change until you commit or revert it. `@tencildev/bridge` takes a
`ChangeTracker` for this; hosts without one don't offer the setting.
