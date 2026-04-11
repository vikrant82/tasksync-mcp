# Feedback UI Guide

This guide explains how to use the TaskSync feedback page when multiple sessions are active.

## Core Concepts

- `Route Here`: Set the session this browser tab will send feedback to. Shows `Current` (disabled) when the session is already the active route target.
- `Set Default`: Set the server fallback session used when no explicit session is provided.
- `Rename`: Set a readable alias for a session row (does not change the real MCP session ID).
- `Prune Stale`: Remove sessions that have been inactive for over 30 minutes. Shows the stale count (e.g., `Prune Stale (3)`), disabled when no stale sessions exist.
- `Auto prune after`: Settings dropdown controlling automatic session cleanup. Options: Never (default), 5/10/20/30/60/120/1440 minutes. When set to "Never", auto-prune is disabled and only manual "Prune Stale" is available.
- `Quick replies`: When the route-target session is waiting, a compact `Approve` / `Continue` strip appears above the editor. These are convenience replies; `Send Feedback` remains the primary action for freeform input.
- `route-target`: Badge showing the session currently selected by this tab.
- `waiting`: Session is currently blocked on `get_feedback` and can be unblocked by sending feedback.
- `queued`: Feedback exists for that session and will be returned on its next `get_feedback` call.

## Wait Banner

The top banner indicates the current wait state:

- **Agent waiting for feedback (Xm Ys)**: The route-target session is blocked on `get_feedback`. A live timer shows how long the agent has been waiting, updated every second.
- **A different session is waiting (Xm Ys)**: A non-target session is waiting. Use `Route Here` to focus it.
- **No session is currently blocked on get_feedback**: Idle state.

## Session Row Status

Each session row shows:

- **Name**: Alias (if set) or session ID (e.g., `opencode-1`)
- **Session ID**: Shown below the name if an alias exists
- **Metadata line**: Created time, last activity (relative), and wait duration when applicable
- **Status chips**: `waiting`/`idle`, `queued`/`no-queue`, `route-target`, `stale`, `new wait`
- **Stale dimming**: Sessions inactive for over 30 minutes are visually dimmed (reduced opacity)

## Notification Modes

Use the controls in the UI:

- `Sound`: Play a short tone for waiting transitions.
- `Desktop`: Show browser desktop notifications.
- `Notify`: Choose behavior:
  - `Focused session`: Notify only for the current route-target.
  - `All sessions`: Notify for any session.

Notifications are transition-based. You are notified when a session changes from not waiting to waiting.

## Why Notifications May Not Fire

### Audio warning: `AudioContext was not allowed to start`

Modern browsers require a user gesture before audio can play.

Fix:
1. Refresh the page.
2. Click anywhere on the page once (or press a key).
3. Keep `Sound` enabled.

### Desktop notifications not shown

Possible causes:
1. Browser permission is not granted.
2. `Desktop` toggle is off.
3. Notification mode excludes the waiting session (`Focused session` mode).

Fix:
1. Enable `Desktop`.
2. Accept the browser permission prompt.
3. If needed, switch `Notify` to `All sessions`.

## Practical Multi-Session Flow

1. Open the feedback page.
2. Find the row with `waiting`.
3. Click `Route Here` on that row.
4. Enter feedback and submit.
5. Use `Set Default` only if you want server fallback behavior to change.

## Image Attachments

You can send images alongside text feedback. Images are delivered to the agent as MCP `ImageContent` blocks.

### Attaching Images

- **Paste**: Copy an image (screenshot, clipboard) and paste into the textbox with Ctrl/Cmd+V
- **Drag & drop**: Drag image files from your file manager onto the textbox
- **File picker**: Click the "Attach Image" button to browse for files

### Preview & Remove

Attached images appear as thumbnails below the textbox. Hover over a thumbnail and click × to remove it before sending.

### Limits

- Up to 10 images per submission
- Maximum 10 MB per image
- Supported formats: PNG, JPEG, GIF, WebP, SVG

### Image-Only Submissions

You can send images without any text — the text field is not required when images are attached.

### Viewing Images in History

Submitted images appear as thumbnails in the conversation history. Click any thumbnail to open a full-size lightbox view (press Escape or click to close).

## Markdown Toolbar

The feedback textbox includes a markdown formatting toolbar and keyboard shortcuts.

### Toolbar Buttons

| Button | Action | Shortcut |
|--------|--------|----------|
| **B** | Bold (`**text**`) | Ctrl/Cmd+B |
| *I* | Italic (`*text*`) | Ctrl/Cmd+I |
| `</>` | Inline code (`` `code` ``) | Ctrl/Cmd+` |
| ` ``` ` | Code block (fenced) | — |
| • | Bullet list (`- item`) | — |
| 1. | Ordered list (`1. item`) | — |
| # | Heading (`## text`) | — |
| 🔗 | Link (`[text](url)`) | Ctrl/Cmd+K |
| — | Horizontal rule (`---`) | — |
| " | Blockquote (`> text`) | — |

### Smart Editing

- **Tab**: Inserts 2 spaces (indent)
- **Shift+Tab**: Removes up to 2 leading spaces (dedent)
- **Enter in lists**: Auto-continues bullet (`- `) or numbered (`1. `) lists. Press Enter on an empty list item to stop the list.
- **Escape**: Exits the textarea (restores normal Tab key navigation)

### Selection Behavior

- With text selected: toolbar buttons wrap the selection (e.g., `**selected**`)
- Without selection: toolbar buttons insert placeholder markers with cursor positioned between them

## Route vs Default

- Route-target is per browser tab and affects this tab's sends/polls.
- Default session is server-side fallback when no explicit session is specified.
- In normal use, `Route Here` is the fastest way to direct feedback to the intended session.
