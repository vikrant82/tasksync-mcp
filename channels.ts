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
  context?: string;
  feedbackUrl: string;
}

export interface FeedbackCallback {
  (sessionId: string, content: string, images?: ImageAttachment[]): void;
}

export interface NotificationChannel {
  readonly name: string;
  initialize(): Promise<void>;
  notify(params: NotificationParams): Promise<void>;
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

      this.log("info", "telegram.callback", { chatId, action, sessionId });
      this.deliverFeedback(sessionId, action);

      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply(`✅ Sent: "${action}"`);
    });

    // Handle unmatched callbacks
    this.bot.on("callback_query:data", async (ctx) => {
      await ctx.answerCallbackQuery();
    });

    // Text replies — deliver as feedback to the active session for this chat
    this.bot.on("message:text", async (ctx) => {
      const chatId = ctx.chat.id;
      if (!this.isAuthorized(chatId)) return;

      const sessionId = this.activeSessionByChat.get(chatId);
      if (!sessionId) {
        await ctx.reply(
          "No active session. Wait for an agent notification first."
        );
        return;
      }

      const text = ctx.message.text;
      this.log("info", "telegram.reply", {
        chatId,
        sessionId,
        contentLength: text.length,
      });

      this.deliverFeedback(sessionId, text);
      await ctx.reply("✅ Feedback sent to agent.");
    });

    // Auto-register allowed chat IDs so they receive notifications without /start after restart
    if (this.allowedChatIds) {
      for (const chatId of this.allowedChatIds) {
        this.registeredChatIds.add(chatId);
      }
    }

    // Start polling (non-blocking via runner)
    this.runner = run(this.bot);
    this.log("info", "telegram.initialized", {
      registeredChatIds: [...this.registeredChatIds],
    });
  }

  async notify(params: NotificationParams): Promise<void> {
    if (this.registeredChatIds.size === 0) {
      this.log("warn", "telegram.notify.no_recipients", {
        sessionId: params.sessionId,
      });
      return;
    }

    const message = this.formatNotification(params);
    const keyboard = this.buildKeyboard(params.sessionId, params.feedbackUrl);

    for (const chatId of this.registeredChatIds) {
      try {
        this.activeSessionByChat.set(chatId, params.sessionId);
        await this.bot.api.sendMessage(chatId, message, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
        this.log("info", "telegram.notify.sent", {
          chatId,
          sessionId: params.sessionId,
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

  private formatNotification(params: NotificationParams): string {
    let msg = `🤖 <b>Agent is waiting for feedback</b>\n`;
    msg += `<i>Session: ${this.escapeHtml(params.sessionId.slice(0, 20))}…</i>\n\n`;

    if (params.context) {
      const truncated =
        params.context.length > 1500
          ? params.context.slice(0, 1500) + "…"
          : params.context;
      msg += `${this.escapeHtml(truncated)}\n\n`;
    }

    msg += `<a href="${params.feedbackUrl}">Open in browser</a>`;
    return msg;
  }

  private buildKeyboard(
    sessionId: string,
    _feedbackUrl: string
  ): InlineKeyboard {
    return new InlineKeyboard()
      .text("👍 Approve", `fb:approve:${sessionId.slice(0, 50)}`)
      .text("👎 Reject", `fb:reject:${sessionId.slice(0, 50)}`)
      .row()
      .text("▶️ Continue", `fb:continue:${sessionId.slice(0, 50)}`);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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
