# Feedback UI Guide

This guide explains how to use the TaskSync feedback page when multiple sessions are active.

## Core Concepts

- `Route Here`: Set the session this browser tab will send feedback to.
- `Set Default`: Set the server fallback session used when no explicit session is provided.
- `route-target`: Badge showing the session currently selected by this tab.
- `waiting`: Session is currently blocked on `get_feedback` and can be unblocked by sending feedback.
- `queued`: Feedback exists for that session and will be returned on its next `get_feedback` call.

## Session Row Status

Each session row shows status chips:

- `waiting` or `idle`
- `queued` or `no-queue`
- `route-target` (only on the selected route session)
- `new wait` badge (if that session recently transitioned into waiting)

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

## Route vs Default

- Route-target is per browser tab and affects this tab's sends/polls.
- Default session is server-side fallback when no explicit session is specified.
- In normal use, `Route Here` is the fastest way to direct feedback to the intended session.
