#!/usr/bin/env node
/**
 * Standalone feedback web UI for TaskSync MCP.
 * Serves a form at http://localhost:PORT with in-memory draft storage.
 *
 * Usage: node dist/feedback-server.js [--port=PORT]
 * Default: port 3456
 */

import express from "express";
import { FEEDBACK_HTML } from "./ui/feedback-html.js";

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const PORT = parseInt(portArg?.split("=")[1] || process.env.FEEDBACK_PORT || "3456", 10);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let currentFeedback = "";
let standaloneAlias = "";
let feedbackHistory: { role: "user"; content: string; createdAt: string }[] = [];
const sseClients = new Set<express.Response>();

function renderStandaloneHtml() {
  return FEEDBACK_HTML
    .replace("FEEDBACK_PATH", "standalone feedback UI with local session state")
    .replace("ACTIVE_SESSION_INFO", `Active session: ${standaloneAlias || "standalone"} | Known sessions: 1`);
}

function buildStandalonePayload() {
  return {
    activeUiSessionId: "standalone",
    sessionId: "standalone",
    latestFeedback: currentFeedback,
    history: feedbackHistory,
    sessions: [
      {
        sessionId: "standalone",
        alias: standaloneAlias,
        sessionUrl: `http://localhost:${PORT}/session/standalone`,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        waitingForFeedback: false,
        hasQueuedFeedback: false,
      },
    ],
  };
}

function broadcastStandaloneState() {
  const payload = JSON.stringify(buildStandalonePayload());
  for (const client of sseClients) {
    client.write(`event: state\ndata: ${payload}\n\n`);
  }
}

app.get("/", (_req, res) => {
  res.type("html").send(renderStandaloneHtml());
});

app.get("/feedback/history", (_req, res) => {
  res.json({ sessionId: "standalone", history: feedbackHistory });
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  sseClients.add(res);
  res.write(`event: state\ndata: ${JSON.stringify(buildStandalonePayload())}\n\n`);
  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.get("/sessions", (_req, res) => {
  const payload = buildStandalonePayload();
  res.json({
    defaultUiSessionId: "standalone",
    activeUiSessionId: "standalone",
    sessions: payload.sessions,
  });
});

app.get("/session/:sessionId", (_req, res) => {
  res.type("html").send(renderStandaloneHtml());
});

const setDefaultSessionHandler = (_req: express.Request, res: express.Response) => {
  res.json({ ok: true, defaultUiSessionId: "standalone", activeUiSessionId: "standalone" });
};

app.post("/sessions/default", setDefaultSessionHandler);
app.post("/sessions/active", setDefaultSessionHandler);

app.post("/sessions/:sessionId/alias", (req, res) => {
  if (req.params.sessionId !== "standalone") {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  standaloneAlias = typeof req.body?.alias === "string" ? req.body.alias.trim().slice(0, 80) : "";
  broadcastStandaloneState();
  res.json({ ok: true, sessionId: "standalone", alias: standaloneAlias });
});

app.delete("/sessions/:sessionId", (_req, res) => {
  res.json({ ok: true });
});

app.post("/feedback", async (req, res) => {
  try {
    currentFeedback = typeof req.body === "string" ? req.body : req.body.content ?? "";
    if (currentFeedback.trim()) {
      feedbackHistory = [
        ...feedbackHistory,
        { role: "user" as const, content: currentFeedback, createdAt: new Date().toISOString() },
      ].slice(-50);
    }
    broadcastStandaloneState();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.error(`Feedback UI running at http://localhost:${PORT}`);
});
