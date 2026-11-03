---
'@tencildev/protocol': minor
'@tencildev/bridge': patch
---

Add the person's preferences (theme and shortcuts):
`preferences.update` from the overlay, `preferences` from the host. Add
`project.source` (how the page's project was found) and `project.choices`
(projects to switch to). The bridge refuses `preferences.update` and
`project.choices`; a host that supports them handles them first, as the
local daemon does.
