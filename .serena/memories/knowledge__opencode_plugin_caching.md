# OpenCode Plugin Caching

OpenCode caches npm plugins in `~/.cache/opencode/` using npm's Arborist.

## Key behavior
- `Npm.add()` (in `opencode/packages/opencode/src/npm/index.ts:62-103`) calls `arborist.loadVirtual()` first
- If the package already exists in the cache, it returns immediately WITHOUT checking the npm registry
- `resolvePluginTarget()` passes `@latest` but Arborist only uses that tag during initial `reify`, not on cache hit
- `~/.cache/opencode/package.json` pins installed versions (e.g. `opencode-tasksync: "1.2.0"`)

## Impact
Restarting OpenCode does NOT update plugins to latest. Users must manually clear the cache:
```bash
rm -rf ~/.cache/opencode/packages/opencode-tasksync@latest
```
Then restart OpenCode — it will re-install the latest version.

## Documentation
This is documented in:
- `README.md` (§Updating)
- `docs/OPENCODE_PLUGIN.md` (§Updating)

This is an OpenCode upstream limitation, not a tasksync-mcp issue.
