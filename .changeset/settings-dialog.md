---
'tencil': minor
---

Settings open in a dialog with pages, grouped by where each setting is
saved: the project's (Agent, Tools), yours (Appearance, Shortcuts, Dock,
Account) and Tencil's (About, with links to the GitHub repo and a debug
section to copy into bug reports).

- Settings start on the Project page: the project's name and folder, and
  how Tencil detected it. Change switches the page to another project; the
  pick holds while Tencil detects the same project on that address, so a
  reused port still goes to the right one.

- Tencil is dark by default now. Appearance switches it to light, or to
  follow the system.
- The theme and shortcuts are saved by the daemon (`preferences.json`), so
  they're the same in every project and browser on the machine.
- A new Dock setting hides Tencil on a site altogether: no toolbar, pins
  or panels. Press Alt+T (⌥T on a Mac) to bring it back or hide it again.
- Shortcuts can be changed on the Shortcuts page: click one and press the
  new keys. Comment, Ruler, Measure (the held key), Hide pins (new, off by
  default) and Hide the dock. Tooltips and hints show the keys you picked.
