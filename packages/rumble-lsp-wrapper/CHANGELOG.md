# rumble-lsp-wrapper

## 0.1.1

### Patch Changes

- [#2](https://github.com/RumbleDB/jsoniq-lsp/pull/2) [`2c0b7e0`](https://github.com/RumbleDB/jsoniq-lsp/commit/2c0b7e0f252ec9c524986f949aedfb1ada2af378) Thanks [@CaiJimmy](https://github.com/CaiJimmy)! - Add `package.json` to rumble-lsp-wrapper, so it can have it's own version number and release cycle.

  One advantage of this is that the release of Rumble LSP Wrapper can be decoupled from the release of language servers. This means we can release language servers without rebuilding Rumble LSP Wrapper if it hasn't changed. This avoids re-downloading the .jar file for rumble-lsp-wrapper when no changes have been made, which can save users who have already downloaded it a lot of time and bandwidth.
