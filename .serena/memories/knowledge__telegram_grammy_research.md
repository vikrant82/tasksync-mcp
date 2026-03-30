# grammY Telegram Bot Framework — Research for Remote Mode

## Decision: Use grammY
- **Package**: `grammy` v1.41.1, MIT, 843K weekly npm downloads
- **Repo**: `grammyjs/grammY` — 3,482 stars, 11 open issues, TypeScript-native
- **Dependencies**: Only 4 (`@grammyjs/types`, `abort-controller`, `debug`, `node-fetch`)
- **Runner**: `@grammyjs/runner` v2.0.3, 570K weekly npm downloads

## Architecture: Long Polling + Runner

Use `@grammyjs/runner` for non-blocking long polling alongside the Express server:

```ts
import { Bot } from "grammy";
import { run } from "@grammyjs/runner";

const bot = new Bot("BOT_TOKEN");
const runner = run(bot);  // Non-blocking, returns RunnerHandle

// Express server runs independently on its own port
app.listen(3000);

// Stop: runner.stop()
```

**Why not webhooks?** Webhooks require public HTTPS URL, don't work in local dev, add deployment complexity. Long polling works behind firewalls, in dev, and is sufficient for low-volume notification use.

**Mutual exclusivity**: grammY enforces that `bot.start()` and `webhookCallback()` cannot be used together. The runner's `run(bot)` replaces `bot.start()`.

## Core Patterns

### User Registration (/start)
```ts
bot.command("start", async (ctx) => {
  const chatId = ctx.chat.id;  // Store this for sending notifications later
  await ctx.reply("Registered!");
});
```
Users MUST message the bot first — Telegram bots cannot initiate conversations.

### Sending Notifications
```ts
// Use HTML parse_mode — much easier than MarkdownV2 (no escaping needed)
await bot.api.sendMessage(chatId, 
  "<b>Agent needs input</b>\n<pre>File: src/auth.ts</pre>",
  { parse_mode: "HTML" }
);
```

### Inline Keyboard for Quick Replies
```ts
import { InlineKeyboard } from "grammy";

const kb = new InlineKeyboard()
  .text("Approve", `fb:approve:${requestId}`).row()
  .text("Reject", `fb:reject:${requestId}`).row()
  .text("Custom reply...", `fb:custom:${requestId}`);

await bot.api.sendMessage(chatId, question, {
  parse_mode: "HTML",
  reply_markup: kb,
});

// Handle button presses (callback data limited to 64 bytes)
bot.callbackQuery(/^fb:approve:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();  // MUST call to dismiss spinner
  await ctx.editMessageText("Approved!");
  // Signal agent to continue
});

// Must handle unmatched callbacks
bot.on("callback_query:data", async (ctx) => {
  await ctx.answerCallbackQuery();
});
```

### Custom Text Replies
Track pending custom input per chat, then handle in `bot.on("message:text", ...)`.

## Formatting Recommendation
Use **HTML** parse mode, not MarkdownV2. MarkdownV2 requires escaping `.!()->#+={}` etc. The opencode-telegram-bot project has a dedicated fallback utility for this reason.

## Reference Project
`grinev/opencode-telegram-bot` (314 stars) — real-world grammY bot for AI coding agent Telegram interface. Key patterns:
- Singleton bot instance with module-level chatId
- QuestionManager state machine for multi-step agent questions
- InlineKeyboard with structured callback data: `"question:action:index:optionIndex"`
- Auth middleware restricting to allowed user IDs
- Markdown fallback utility for message formatting
- ResponseStreamer for real-time agent output via message edits

## Install
```
npm install grammy @grammyjs/runner
```
