# HTTP Endpoint cURL Examples

Set base URL first:

```bash
UI_BASE="http://localhost:3456"
MCP_BASE="http://localhost:3011"
```

## Health

```bash
curl -s "$MCP_BASE/health" | jq .
```

## Read Current Feedback

```bash
curl -s "$UI_BASE/feedback"
```

## Submit Feedback (active/default session routing)

```bash
curl -s -X POST "$UI_BASE/feedback" \
  -H "Content-Type: application/json" \
  -d '{"content":"Please refine the error handling path."}' | jq .
```

## Submit Feedback (explicit session routing)

```bash
SESSION_ID="replace-with-session-id"
curl -s -X POST "$UI_BASE/feedback" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"This is routed to one session only.\",\"sessionId\":\"$SESSION_ID\"}" | jq .
```

## List Sessions

```bash
curl -s "$UI_BASE/sessions" | jq .
```

## Set Active Session

```bash
SESSION_ID="replace-with-session-id"
curl -s -X POST "$UI_BASE/sessions/active" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\"}" | jq .
```

## Disconnect Session

```bash
SESSION_ID="replace-with-session-id"
curl -s -X DELETE "$UI_BASE/sessions/$SESSION_ID" | jq .
```

## Open Session-Specific UI URL

```bash
SESSION_ID="replace-with-session-id"
echo "$UI_BASE/session/$SESSION_ID"
```
