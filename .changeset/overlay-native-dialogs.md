---
"tencil": patch
---

You can type in the composer while a native modal `<dialog>` or a React Native Web `Modal` is open on the page. A modal dialog made everything outside it unusable, Tencil included, so Tencil now moves into the open dialog and back out when it closes. React Native Web's `Modal` pulled focus out of the composer as soon as it got it.
