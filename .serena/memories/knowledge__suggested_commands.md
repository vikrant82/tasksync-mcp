# Suggested Commands
## Setup
- `npm install`
- `npm run build`

## Run
- NPM shortcut: `npm run start`
- Streamable HTTP MCP: `node dist/index.js --port=3011`
- Disable UI: add `--no-ui`
- Set UI port: `--ui-port=3460` or env `FEEDBACK_PORT=3460`
- Debug logs: `TASKSYNC_LOG_LEVEL=debug node dist/index.js --port=3011 --no-ui`

## Development
- Watch compile: `npm run watch`
- Dev rebuild + start: `npm run dev`

## Testing
- Run tests: `npm test`

## Useful Linux shell commands
- Search code: `rg "pattern"`
- List files fast: `rg --files`
- Read with context: `sed -n 'start,endp' file`
- Git status/diff: `git status`, `git diff`
