Because `.jar` file from `rumble-lsp-wrapper` is too large, we distribute it as a separate asset via GitHub Releases. When building the language server, it will attach a `release-manifest.json` file to this folder, which contains the URL and the SHA256 checksum of the `.jar` file.

The language server will download the `.jar` file from the URL and verify its integrity using the checksum before using it.
