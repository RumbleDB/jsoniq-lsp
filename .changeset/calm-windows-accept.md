---
"jsoniq-language-server": patch
---

Add a `.npmignore` file to the `assets/function-doc` folder to ensure that the `custom-functions.json` file is uploaded to the npm registry.

By default, because it's part of `.gitignore`, it is not uploaded.
