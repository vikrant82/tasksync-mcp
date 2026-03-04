# Multi-Session Flow (cURL + MCP Header)

This flow demonstrates two independent Streamable HTTP sessions sharing one TaskSync process.

Prerequisites:

```bash
node dist/index.js --port=3011 --ui-port=3456
MCP_BASE="http://localhost:3011"
UI_BASE="http://localhost:3456"
```

## 1) Initialize session A

```bash
INIT_A=$(curl -si -X POST "$MCP_BASE/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"init-a","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl-a","version":"1.0"}}}')
SESSION_A=$(printf "%s" "$INIT_A" | tr -d '\r' | awk -F': ' '/^mcp-session-id:/ {print $2}' | tail -n1)
echo "SESSION_A=$SESSION_A"
```

## 2) Initialize session B

```bash
INIT_B=$(curl -si -X POST "$MCP_BASE/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"init-b","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl-b","version":"1.0"}}}')
SESSION_B=$(printf "%s" "$INIT_B" | tr -d '\r' | awk -F': ' '/^mcp-session-id:/ {print $2}' | tail -n1)
echo "SESSION_B=$SESSION_B"
```

## 3) Verify both sessions are listed

```bash
curl -s "$UI_BASE/sessions" | jq .
```

## 4) Route feedback only to session A

```bash
curl -s -X POST "$UI_BASE/feedback" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Feedback for session A\",\"sessionId\":\"$SESSION_A\"}" | jq .
```

## 5) Route feedback only to session B

```bash
curl -s -X POST "$UI_BASE/feedback" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Feedback for session B\",\"sessionId\":\"$SESSION_B\"}" | jq .
```

## 6) (Optional) Send MCP request on a specific session

```bash
curl -s -X POST "$MCP_BASE/mcp" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_A" \
  -d '{"jsonrpc":"2.0","id":"tools-a","method":"tools/list","params":{}}' | jq .
```

## 7) Disconnect one session

```bash
curl -s -X DELETE "$UI_BASE/sessions/$SESSION_B" | jq .
```

## 8) Confirm remaining session set

```bash
curl -s "$UI_BASE/sessions" | jq .
```
