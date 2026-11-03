---
'@tencildev/protocol': minor
'@tencildev/bridge': minor
'tencil': minor
---

Comments on pins, for hosts that turn them on (Tencil Cloud): teammates talk in a pin, `@mention` each other, and hand the discussion to the agent with `@tencil`.

- Protocol: `comment` messages, an optional `author` on messages, the `discussion` status, `Member`, and `comments` and `members` in `ready`. `mentionsOf`, `mentionsAgent` and `AGENT_HANDLE` come from the package and from `@tencildev/protocol/mentions`, which has no zod.
- Bridge: `comments: true` makes a message a comment unless it mentions `@tencil`. A new pin without the tag is a discussion. Tagging it starts the agent with what the team said, and a follow-up tells the agent what the team said since its last turn. Messages get their author from the client's `viewer`, and `members` on a client is sent in `ready`.
- Overlay: author avatars and names, comment bubbles, highlighted mentions, an `@` popup in the comment box, and a neutral "Discussion" pin. With comments on, read-only viewers can comment but can't tag `@tencil`.

The local daemon doesn't turn comments on, so nothing changes there.
