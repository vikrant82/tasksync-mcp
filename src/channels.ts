import { Bot, InlineKeyboard } from "grammy";
import { run, type RunnerHandle } from "@grammyjs/runner";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────

export interface ImageAttachment {
  data: string;
  mimeType: string;
}

export interface NotificationParams {
  sessionId: string;
  sessionAlias?: string;
  context?: string;
}

export interface FeedbackCallback {
  (sessionId: string, content: string, images?: ImageAttachment[]): void;
}

export interface FYIParams {
  sessionId: string;
  sessionAlias?: string;
  context: string;
}

export interface NotificationChannel {
  readonly name: string;
  initialize(): Promise<void>;
  notify(params: NotificationParams): Promise<void>;
  sendFYI(params: FYIParams): Promise<void>;
  onFeedback(callback: FeedbackCallback): void;
  shutdown(): Promise<void>;
}

export interface ChannelManagerConfig {
  telegram?: TelegramChannelConfig;
}

export interface TelegramChannelConfig {
  botToken: string;
  allowedChatIds?: number[];
}

type LogFn = (
  level: "debug" | "info" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>
) => void;

// ── Telegram Channel ─────────────────────────────────────────────────

/**
 * Sends notifications via Telegram bot and receives text replies as feedback.
 *
 * Users register by sending /start to the bot. The server stores their chatId.
 * When an agent waits for feedback, the bot sends a notification with the
 * agent's context. Users can reply inline, and the reply is delivered as
 * feedback to the waiting session.
 */
export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram";

  private bot: Bot;
  private runner: RunnerHandle | null = null;
  private feedbackCallbacks: FeedbackCallback[] = [];
  private registeredChatIds = new Set<number>();
  private allowedChatIds: Set<number> | null;
  private log: LogFn;
  private static CHAT_IDS_PATH = join(homedir(), ".tasksync", "telegram-chats.json");

  /** Maps chatId to the sessionId they last received a notification for */
  private activeSessionByChat = new Map<number, string>();

  /** Maps Telegram message IDs to sessionIds for reply-to routing */
  private messageToSession = new Map<number, string>();

  /** Caches session aliases learned from notify/FYI params for reply confirmations */
  private sessionAliasCache = new Map<string, string>();

  constructor(config: TelegramChannelConfig, log: LogFn) {
    this.bot = new Bot(config.botToken);
    this.allowedChatIds =
      config.allowedChatIds && config.allowedChatIds.length > 0
        ? new Set(config.allowedChatIds)
        : null;
    this.log = log;
  }

  /** Load persisted chat IDs from ~/.tasksync/telegram-chats.json */
  private loadPersistedChatIds(): number[] {
    try {
      const data = readFileSync(TelegramChannel.CHAT_IDS_PATH, "utf-8");
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number") : [];
    } catch {
      return [];
    }
  }

  /** Persist registered chat IDs to ~/.tasksync/telegram-chats.json */
  private persistChatIds(): void {
    try {
      mkdirSync(join(homedir(), ".tasksync"), { recursive: true });
      writeFileSync(TelegramChannel.CHAT_IDS_PATH, JSON.stringify([...this.registeredChatIds]), "utf-8");
    } catch (err) {
      this.log("warn", "telegram.persist.error", { error: String(err) });
    }
  }

  async initialize(): Promise<void> {
    // Restore previously registered chat IDs from disk
    for (const chatId of this.loadPersistedChatIds()) {
      this.registeredChatIds.add(chatId);
    }

    // Also pre-register explicitly configured allowed chat IDs
    if (this.allowedChatIds) {
      for (const chatId of this.allowedChatIds) {
        this.registeredChatIds.add(chatId);
      }
    }

    // Global error handler for bot middleware errors
    this.bot.catch((err) => {
      this.log("error", "telegram.bot.error", {
        error: String(err.error ?? err),
      });
    });

    // /start — user registration
    this.bot.command("start", async (ctx) => {
      const chatId = ctx.chat.id;

      if (this.allowedChatIds && !this.allowedChatIds.has(chatId)) {
        this.log("warn", "telegram.start.unauthorized", { chatId });
        await ctx.reply("You are not authorized to use this bot.");
        return;
      }

      this.registeredChatIds.add(chatId);
      this.persistChatIds();
      this.log("info", "telegram.start.registered", { chatId });
      await ctx.reply(
        "✅ Registered for TaskSync notifications.\n\n" +
          "You'll receive messages here when an agent is waiting for feedback. " +
          "Reply directly to respond."
      );
    });

    // /status — check bot health
    this.bot.command("status", async (ctx) => {
      const chatId = ctx.chat.id;
      if (!this.isAuthorized(chatId)) return;

      const activeSession = this.activeSessionByChat.get(chatId);
      await ctx.reply(
        `🤖 TaskSync Bot\n` +
          `Registered: ✅\n` +
          `Active session: ${activeSession ?? "none"}`
      );
    });

    // Inline keyboard callback — quick reply buttons
    this.bot.callbackQuery(/^fb:(.+):(.+)$/, async (ctx) => {
      const match = ctx.match;
      if (!match) return;

      const action = match[1];
      const sessionId = match[2];
      const chatId = ctx.chat?.id;

      if (!chatId || !this.isAuthorized(chatId)) {
        await ctx.answerCallbackQuery({ text: "Not authorized" });
        return;
      }

      await ctx.answerCallbackQuery();

      if (action === "open") {
        // "Open in browser" doesn't send feedback — it's just a hint
        return;
      }

      const feedbackText = action === "stop"
        ? "All tasks accomplished, we can **Stop** now. If you are a sub agent, repeat all the summary and information in one last message and stop. Do not call get_feedback again. If you are the main agent, you can just stop."
        : action === "pause"
        ? "$pause-session — Pause this session now. Load the pause-session skill and follow its full protocol."
        : action;
      this.log("info", "telegram.callback", { chatId, action, sessionId });
      this.deliverFeedback(sessionId, feedbackText);

      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply(`✅ Sent "${action}" to ${this.sessionLabel(sessionId)}`);
    });

    // Handle unmatched callbacks
    this.bot.on("callback_query:data", async (ctx) => {
      await ctx.answerCallbackQuery();
    });

    // Text replies — deliver as feedback. Reply-to routing takes priority, then falls back to last-notified session.
    this.bot.on("message:text", async (ctx) => {
      const chatId = ctx.chat.id;
      if (!this.isAuthorized(chatId)) return;

      // Check if user replied to a specific notification message → route to that session
      const replyToId = ctx.message.reply_to_message?.message_id;
      let sessionId = replyToId ? this.messageToSession.get(replyToId) : undefined;

      // Fall back to the last-notified session for this chat
      if (!sessionId) {
        sessionId = this.activeSessionByChat.get(chatId);
      }

      if (!sessionId) {
        await ctx.reply(
          "No active session. Wait for an agent notification first.\n\n" +
          "💡 Tip: Reply to a specific notification message to target that session."
        );
        return;
      }

      const text = ctx.message.text;
      this.log("info", "telegram.reply", {
        chatId,
        sessionId,
        replyRouted: !!replyToId && !!this.messageToSession.get(replyToId!),
        contentLength: text.length,
      });

      this.deliverFeedback(sessionId, text);
      await ctx.reply(`✅ Feedback sent to ${this.sessionLabel(sessionId)}`);
    });

    // Auto-register allowed chat IDs so they receive notifications without /start after restart
    if (this.allowedChatIds) {
      for (const chatId of this.allowedChatIds) {
        this.registeredChatIds.add(chatId);
      }
    }

    // Start polling (non-blocking via runner)
    this.runner = run(this.bot);

    // Monitor runner for fatal errors (e.g., 409 Conflict from another bot instance)
    // Without this, runner crashes become unhandled promise rejections that kill the process
    const runnerTask = this.runner.task();
    if (runnerTask) {
      runnerTask.catch((err) => {
        const errStr = String(err);
        if (errStr.includes("409") || errStr.includes("Conflict")) {
          this.log("error", "telegram.runner.conflict", {
            error: "Another bot instance is polling with the same token. Each TaskSync server needs its own Telegram bot. Polling stopped — outbound notifications may still work.",
          });
        } else {
          this.log("error", "telegram.runner.fatal", { error: errStr });
        }
        this.runner = null;
      });
    }

    this.log("info", "telegram.initialized", {
      registeredChatIds: [...this.registeredChatIds],
    });
  }

  /** Send a message with HTML parse_mode; on parse error, retry as plain text */
  private async sendMessageSafe(
    chatId: number,
    text: string,
    options: Record<string, unknown>
  ): Promise<{ message_id: number } | null> {
    // Repair any malformed HTML before sending
    const repairedText =
      options.parse_mode === "HTML" ? this.repairHtml(text) : text;
    try {
      return await this.bot.api.sendMessage(
        chatId,
        repairedText,
        options as Parameters<typeof this.bot.api.sendMessage>[2]
      );
    } catch (err) {
      const errStr = String(err);
      if (
        errStr.includes("can't parse entities") ||
        errStr.includes("Bad Request")
      ) {
        this.log("warn", "telegram.html_fallback", {
          chatId,
          error: errStr,
        });
        // Strip all HTML tags and retry as plain text
        const plainText = repairedText.replace(/<[^>]+>/g, "");
        const { parse_mode, ...rest } = options;
        return await this.bot.api.sendMessage(
          chatId,
          plainText,
          rest as Parameters<typeof this.bot.api.sendMessage>[2]
        );
      }
      throw err;
    }
  }

  async notify(params: NotificationParams): Promise<void> {
    if (this.registeredChatIds.size === 0) {
      this.log("warn", "telegram.notify.no_recipients", {
        sessionId: params.sessionId,
      });
      return;
    }

    if (params.sessionAlias) {
      this.sessionAliasCache.set(params.sessionId, params.sessionAlias);
    }

    const messageParts = this.formatNotificationParts(params);
    const keyboard = this.buildKeyboard(params.sessionId);

    for (const chatId of this.registeredChatIds) {
      try {
        this.activeSessionByChat.set(chatId, params.sessionId);
        for (let i = 0; i < messageParts.length; i++) {
          const isLast = i === messageParts.length - 1;
          const sent = await this.sendMessageSafe(chatId, messageParts[i], {
            parse_mode: "HTML",
            ...(isLast ? { reply_markup: keyboard } : {}),
          });
          if (sent) {
            this.messageToSession.set(sent.message_id, params.sessionId);
            if (this.messageToSession.size > 200) {
              const oldest = this.messageToSession.keys().next().value;
              if (oldest !== undefined) this.messageToSession.delete(oldest);
            }
          }
        }
        this.log("info", "telegram.notify.sent", {
          chatId,
          sessionId: params.sessionId,
          parts: messageParts.length,
        });
      } catch (err) {
        this.log("error", "telegram.notify.error", {
          chatId,
          sessionId: params.sessionId,
          error: String(err),
        });
      }
    }
  }


  async sendFYI(params: FYIParams): Promise<void> {
    if (this.registeredChatIds.size === 0) {
      this.log("warn", "telegram.fyi.no_recipients", {
        sessionId: params.sessionId,
      });
      return;
    }

    if (params.sessionAlias) {
      this.sessionAliasCache.set(params.sessionId, params.sessionAlias);
    }

    const messageParts = this.formatFYIParts(params);

    for (const chatId of this.registeredChatIds) {
      try {
        for (const part of messageParts) {
          await this.sendMessageSafe(chatId, part, {
            parse_mode: "HTML",
          });
        }
        this.log("info", "telegram.fyi.sent", {
          chatId,
          sessionId: params.sessionId,
          parts: messageParts.length,
        });
      } catch (err) {
        this.log("error", "telegram.fyi.error", {
          chatId,
          sessionId: params.sessionId,
          error: String(err),
        });
      }
    }
  }

  onFeedback(callback: FeedbackCallback): void {
    this.feedbackCallbacks.push(callback);
  }

  async shutdown(): Promise<void> {
    if (this.runner) {
      this.runner.stop();
      this.runner = null;
    }
    this.log("info", "telegram.shutdown", {});
  }

  // ── Private ──────────────────────────────────────────────────────

  private isAuthorized(chatId: number): boolean {
    if (this.allowedChatIds && !this.allowedChatIds.has(chatId)) return false;
    return this.registeredChatIds.has(chatId);
  }

  private sessionLabel(sessionId: string): string {
    const alias = this.sessionAliasCache.get(sessionId);
    return alias && alias !== sessionId ? alias : `${sessionId.slice(0, 12)}…`;
  }

  private deliverFeedback(sessionId: string, content: string): void {
    for (const cb of this.feedbackCallbacks) {
      try {
        cb(sessionId, content);
      } catch (err) {
        this.log("error", "telegram.feedback.callback_error", {
          sessionId,
          error: String(err),
        });
      }
    }
  }

  private formatNotificationParts(params: NotificationParams): string[] {
    const TELEGRAM_MAX = 4000; // leave margin under 4096 for safety
    const sessionLabel = params.sessionAlias && params.sessionAlias !== params.sessionId
      ? this.escapeHtml(params.sessionAlias)
      : `${this.escapeHtml(params.sessionId.slice(0, 20))}…`;
    const header = `🤖 <b>Agent is waiting for feedback</b>\n<i>Session: ${sessionLabel}</i>\n\n`;

    if (!params.context) {
      return [header.trimEnd()];
    }

    const contextHtml = this.markdownToTelegramHtml(params.context);

    // If it all fits in one message, send as one
    const singleMessage = header + contextHtml;
    if (singleMessage.length <= TELEGRAM_MAX) {
      return [singleMessage];
    }

    // Split context into chunks at paragraph boundaries (\n\n)
    const paragraphs = contextHtml.split("\n\n");
    const parts: string[] = [];
    let current = header;

    for (const para of paragraphs) {
      const addition = (current.length > header.length ? "\n\n" : "") + para;
      if (current.length + addition.length > TELEGRAM_MAX && current.length > header.length) {
        parts.push(current);
        current = para;
      } else {
        current += addition;
      }
    }

    // If a single paragraph exceeds the limit, force-split at line boundaries
    if (current.length > TELEGRAM_MAX) {
      const lines = current.split("\n");
      let chunk = "";
      for (const line of lines) {
        if (chunk.length + line.length + 1 > TELEGRAM_MAX && chunk.length > 0) {
          parts.push(chunk);
          chunk = line;
        } else {
          chunk += (chunk ? "\n" : "") + line;
        }
      }
      current = chunk;
    }

    parts.push(current);

    return parts;
  }


  private formatFYIParts(params: FYIParams): string[] {
    const TELEGRAM_MAX = 4000;
    const sessionLabel = params.sessionAlias && params.sessionAlias !== params.sessionId
      ? this.escapeHtml(params.sessionAlias)
      : `${this.escapeHtml(params.sessionId.slice(0, 20))}…`;
    const header = `📋 <b>Agent Status Update</b>\n<i>Session: ${sessionLabel}</i>\n\n`;
    const footer = `\n\n<i>ℹ️ No response needed — this is an informational update.</i>`;
    const contextHtml = this.markdownToTelegramHtml(params.context);

    const singleMessage = header + contextHtml + footer;
    if (singleMessage.length <= TELEGRAM_MAX) {
      return [singleMessage];
    }

    // Split at paragraph boundaries, same logic as formatNotificationParts
    const paragraphs = contextHtml.split("\n\n");
    const parts: string[] = [];
    let current = header;

    for (const para of paragraphs) {
      const addition = (current.length > header.length ? "\n\n" : "") + para;
      if (current.length + addition.length > TELEGRAM_MAX && current.length > header.length) {
        parts.push(current);
        current = para;
      } else {
        current += addition;
      }
    }

    if (current.length > TELEGRAM_MAX) {
      const lines = current.split("\n");
      let chunk = "";
      for (const line of lines) {
        if (chunk.length + line.length + 1 > TELEGRAM_MAX && chunk.length > 0) {
          parts.push(chunk);
          chunk = line;
        } else {
          chunk += (chunk ? "\n" : "") + line;
        }
      }
      current = chunk;
    }

    if (current.length + footer.length <= TELEGRAM_MAX) {
      parts.push(current + footer);
    } else {
      parts.push(current);
      parts.push(footer);
    }

    return parts;
  }

  private buildKeyboard(sessionId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text("👍 Approve", `fb:approve:${sessionId.slice(0, 50)}`)
      .text("👎 Reject", `fb:reject:${sessionId.slice(0, 50)}`)
      .row()
      .text("▶️ Continue", `fb:continue:${sessionId.slice(0, 50)}`)
      .text("🛑 Stop", `fb:stop:${sessionId.slice(0, 50)}`)
      .row()
      .text("⏸️ Pause", `fb:pause:${sessionId.slice(0, 50)}`);
  }


  /**
   * Repairs malformed HTML by ensuring all tags are properly nested.
   * Handles two cases:
   *  1. Overlapping tags (e.g. `<b>...<i>...</b>...</i>`) — closes and reopens
   *     inner tags at the boundary so each element is well-nested.
   *  2. Stray close tags with no matching open — removes them.
   *  3. Unclosed tags at end of string — appends closing tags.
   */
  private repairHtml(html: string): string {
    const telegramTags = new Set([
      "b",
      "strong",
      "i",
      "em",
      "u",
      "ins",
      "s",
      "strike",
      "del",
      "code",
      "pre",
      "a",
      "blockquote",
      "tg-spoiler",
      "tg-emoji",
    ]);
    const tagRegex = /<(\/?)([a-z][a-z0-9-]*)(\s[^>]*)?>/gi;
    // Stack stores { tag, openTag } to preserve attributes when reopening
    const stack: Array<{ tag: string; openTag: string }> = [];
    let result = "";
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(html)) !== null) {
      const [fullTag, slash, rawName] = match;
      const tag = rawName.toLowerCase();
      if (!telegramTags.has(tag)) continue;

      const isClosing = slash === "/";

      if (!isClosing) {
        stack.push({ tag, openTag: fullTag });
      } else {
        const openIdx = stack.findLastIndex((s) => s.tag === tag);
        if (openIdx === -1) {
          // Stray close tag (no matching open) → remove it
          result += html.slice(lastIdx, match.index);
          lastIdx = match.index + fullTag.length;
          continue;
        }
        if (openIdx < stack.length - 1) {
          // Intervening open tags must be closed and reopened
          const intervening = stack.splice(openIdx + 1);
          stack.pop();

          const closers = intervening
            .slice()
            .reverse()
            .map((s) => `</${s.tag}>`)
            .join("");
          const reopeners = intervening.map((s) => s.openTag).join("");

          result +=
            html.slice(lastIdx, match.index) + closers + fullTag + reopeners;
          lastIdx = match.index + fullTag.length;

          for (const s of intervening) {
            stack.push(s);
          }
        } else {
          stack.pop();
        }
      }
    }

    result += html.slice(lastIdx);

    while (stack.length > 0) {
      result += `</${stack.pop()!.tag}>`;
    }

    return result;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /** Convert common markdown patterns to Telegram HTML. Escapes HTML first for safety. */
  private markdownToTelegramHtml(text: string): string {
    // Protect code blocks and inline code from further processing
    const placeholders: string[] = [];
    const placeholder = (html: string) => {
      const idx = placeholders.length;
      placeholders.push(html);
      return `\x00PH${idx}\x00`;
    };

    let html = this.escapeHtml(text);

    // Code blocks: ```lang\n...\n``` → <pre><code>...</code></pre>
    html = html.replace(/```(?:\w*)\n([\s\S]*?)```/g, (_m, code) =>
      placeholder(`<pre><code>${code}</code></pre>`)
    );

    // Inline code: `...` → <code>...</code>
    html = html.replace(/`([^`]+)`/g, (_m, code) =>
      placeholder(`<code>${code}</code>`)
    );

    // Bold+italic: ***text*** or ___text___
    html = html.replace(/\*{3}(.+?)\*{3}/g, "<b><i>$1</i></b>");

    // Bold: **text** or __text__
    html = html.replace(/\*{2}(.+?)\*{2}/g, "<b>$1</b>");
    html = html.replace(/_{2}(.+?)_{2}/g, "<b>$1</b>");

    // Italic: *text* or _text_ (but not inside words like foo_bar_baz)
    html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");
    html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>");

    // Strikethrough: ~~text~~
    html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

    // Headers: # text → bold (Telegram has no native headers)
    html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

    // Bullet lists: - item or * item → • item
    html = html.replace(/^[\s]*[-*]\s+/gm, "• ");

    // Numbered lists: 1. item → keep as-is (already readable)

    // Links: [text](url) → <a href="url">text</a>
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Blockquotes: > text → "text" (Telegram has blockquote but only in recent clients)
    html = html.replace(/^&gt;\s?(.+)$/gm, "┃ <i>$1</i>");

    // Restore code placeholders
    html = html.replace(/\x00PH(\d+)\x00/g, (_m, idx) => placeholders[parseInt(idx)]);

    return html;
  }
}

// ── Channel Manager ──────────────────────────────────────────────────

/**
 * Manages notification channels. Channels are initialized on startup
 * based on config. The manager dispatches notifications to all active
 * channels and routes feedback from any channel to the session manager.
 */
export class ChannelManager {
  private channels = new Map<string, NotificationChannel>();
  private feedbackCallback: FeedbackCallback | null = null;
  private log: LogFn;

  constructor(log: LogFn) {
    this.log = log;
  }

  async initialize(config: ChannelManagerConfig): Promise<void> {
    if (config.telegram?.botToken) {
      const telegram = new TelegramChannel(config.telegram, this.log);
      telegram.onFeedback((sessionId, content, images) => {
        this.feedbackCallback?.(sessionId, content, images);
      });
      await telegram.initialize();
      this.channels.set("telegram", telegram);
      this.log("info", "channels.telegram.enabled", {});
    }

    this.log("info", "channels.initialized", {
      activeChannels: [...this.channels.keys()],
    });
  }

  get hasChannels(): boolean {
    return this.channels.size > 0;
  }

  onFeedback(callback: FeedbackCallback): void {
    this.feedbackCallback = callback;
  }

  async notify(params: NotificationParams): Promise<void> {
    if (this.channels.size === 0) return;

    this.log("info", "channels.notify", {
      sessionId: params.sessionId,
      channelCount: this.channels.size,
      hasContext: Boolean(params.context),
    });

    const promises = [...this.channels.values()].map((ch) =>
      ch.notify(params).catch((err) => {
        this.log("error", "channels.notify.error", {
          channel: ch.name,
          sessionId: params.sessionId,
          error: String(err),
        });
      })
    );
    await Promise.all(promises);
  }


  async sendFYI(params: FYIParams): Promise<void> {
    if (this.channels.size === 0) return;

    this.log("info", "channels.fyi", {
      sessionId: params.sessionId,
      channelCount: this.channels.size,
      contextLength: params.context.length,
    });

    const promises = [...this.channels.values()].map((ch) =>
      ch.sendFYI(params).catch((err) => {
        this.log("error", "channels.fyi.error", {
          channel: ch.name,
          sessionId: params.sessionId,
          error: String(err),
        });
      })
    );
    await Promise.all(promises);
  }

  async shutdown(): Promise<void> {
    for (const [name, ch] of this.channels) {
      try {
        await ch.shutdown();
      } catch (err) {
        this.log("error", "channels.shutdown.error", {
          channel: name,
          error: String(err),
        });
      }
    }
    this.channels.clear();
    this.log("info", "channels.shutdown", {});
  }
}
