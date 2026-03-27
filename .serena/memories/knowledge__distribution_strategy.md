# Distribution Strategy

## Primary: npm with Bundled Single-File

Use `esbuild` to bundle plugin + `@tasksync/core` into one distributable file.

### Plugin (`opencode-tasksync`)
- Bundle: inline `@tasksync/core`, keep `@opencode-ai/plugin`, `zod`, `express` as external
- Users add: `"plugin": ["opencode-tasksync"]` to opencode.json
- npm publish as public package

### MCP Server (`tasksync-mcp`)
- Bundle: inline `@tasksync/core`, keep `@modelcontextprotocol/sdk`, `express`, `zod` as external
- Users run: `npx tasksync-mcp` or `node dist/index.js`
- Configure: `{ "type": "remote", "url": "http://localhost:3011/mcp" }` in opencode.json

### Package.json needs
- description, keywords, license (MIT), repository URL, homepage
- `"files": ["dist/"]`
- `"exports": { ".": "./dist/index.js" }`
- `peerDependencies` for plugin SDK, regular deps for express/zod
- `bin` field for MCP server CLI

### Build setup
- Add `esbuild` as dev dependency
- Build script: `esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js --external:...`
- Can also do `tsc -b` for type checking + `esbuild` for bundling

## Secondary: Manual/Local Install
- Clone repo, build, copy dist to `~/.config/opencode/plugins/opencode-tasksync/` or `.opencode/plugins/`

## Not yet explored
- GitHub URL support in OpenCode plugin loading
- GitHub Releases with pre-built bundles
