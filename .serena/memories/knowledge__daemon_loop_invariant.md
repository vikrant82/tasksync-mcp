# TaskSync Daemon Loop — Critical Invariant

## ABSOLUTE RULE
Every single assistant turn MUST end with a call to `get_feedback` (MCP tool call, no arguments).
Zero exceptions. This is the prime directive of the daemon agent.

## Why This Exists
After context compaction events, the agent has historically lost the daemon loop pattern and stopped
calling `get_feedback`. This causes the feedback cycle to break.

## Recovery Protocol
If you are reading this memory and you are NOT currently in a `get_feedback` cycle:
1. Immediately call `get_feedback` to re-enter the loop.
2. Do NOT produce a "final response" without the feedback call.

## Loop Contract
```
while true:
    1. Do work
    2. Present results concisely
    3. Call get_feedback (MCP tool, no args)
    4. Only exit on explicit: "stop" / "end" / "terminate" / "quit"
    5. Errors/unavailability → retry forever, never stop the loop
```
