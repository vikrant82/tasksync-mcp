Updated: 2026-04-11

# Feedback UI Architecture & UX

## Layout
- Two-column layout: left (composer + history), right (sessions + settings)
- History is bounded, collapsible, scrollable, with jump-to-latest behavior
- Live updates via EventSource `/events`

## Session Management
- Session rows expose `Rename`, `Route Here`, `Set Default`, remote toggle, and `Disconnect`
- `Prune Stale` removes sessions inactive for over 30 minutes and displays a stale count when applicable
- Auto-prune dropdown: `Never` (default and now correctly persisted), `5`, `10`, `20`, `30`, `60`, `120`, `1440` minutes
- `Never` disables auto-prune; `Prune Stale` remains available for manual cleanup
- Wait banner shows live elapsed time for the route-target session

## Composer / Input UX
- Markdown toolbar above the textarea with formatting shortcuts
- Images can be pasted, dragged, or selected via file picker; previews are shown inline
- When the route-target session is waiting, a compact `Quick replies` strip appears above the editor with `Approve`, `Continue`, `Stop` (red/danger styled, sends termination message with sub-agent instruction), and `Pause Session` (triggers pause-session skill protocol for handoff memory writing)
- `Send Feedback` remains the sole primary action; `Clear Draft` and `Attach Image` are grouped as neutral utilities below the editor
- Goal of the latest tweak: reduce visual competition between canned responses and the main freeform submit path

## Agent Context Panel
- Settings checkbox enables assistant-message display (off by default)
- Panel is collapsible and renders markdown
- Heading distinguishes `Agent status update` (FYI source) vs `Last assistant message` (assistant source)

## Notifications
- Sound and desktop notification toggles
- Modes: focused session only or all sessions
- Notifications fire on transition into waiting state

## Backend Contract
- `/feedback` accepts text and optional base64 images
- `/feedback/history` returns bounded submitted history
- `/events` pushes UI state including wait timers, sessions, `agentContext`, and `channelsAvailable`
