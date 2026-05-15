---
"rumble-lsp-wrapper": patch
---

Add `package.json` to rumble-lsp-wrapper, so it can have it's own version number and release cycle.

One advantage of this is that the release of Rumble LSP Wrapper can be decoupled from the release of language servers. This means we can release language servers without rebuilding Rumble LSP Wrapper if it hasn't changed. This avoids re-downloading the .jar file for rumble-lsp-wrapper when no changes have been made, which can save users who have already downloaded it a lot of time and bandwidth.
