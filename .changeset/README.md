# Changesets

This directory stores release notes and version intent for the workspace.

Typical workflow:

1. Run `pnpm changeset` after making a change that should affect a released package.
2. Commit the generated markdown file in `.changeset/`.
3. Run `pnpm release:version` when preparing a release. This updates package versions, internal workspace dependencies, and package changelogs.
4. Run `pnpm release:publish` to publish npm packages from the workspace.

Notes for this repository:

- `packages/language-server` is publishable to npm and will be included in `changeset publish`.
- `packages/vscode-extension` remains `private: true`, so it will be versioned and get changelog entries, but it will not be published to npm (because it will be published to the VS Code Marketplace instead).
- `packages/rumble-lsp-wrapper` is also `private: true`; changesets versions it so wrapper jar uploads can be reused across releases. When the wrapper changes, include the language server in the release plan as well so it ships an updated wrapper manifest.
