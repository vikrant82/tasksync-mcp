#!/usr/bin/env node
/**
 * Standalone feedback web UI for TaskSync MCP.
 * Serves a form at http://localhost:PORT with in-memory draft storage.
 *
 * Usage: node dist/feedback-server.js [--port=PORT]
 * Default: port 3456
 */

import express from "express";
import { FEEDBACK_HTML } from "./feedback-html.js";

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const PORT = parseInt(portArg?.split("=")[1] || process.env.FEEDBACK_PORT || "3456", 10);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let currentFeedback = "";

app.get("/", (_req, res) => {
  res.type("html").send(
    FEEDBACK_HTML
      .replace("FEEDBACK_PATH", "in-memory feedback queue (non-persistent)")
      .replace("ACTIVE_SESSION_INFO", "Active session: standalone | Known sessions: 1")
  );
});

app.get("/feedback", (_req, res) => {
  res.type("text").send(currentFeedback);
});

app.get("/sessions", (_req, res) => {
  res.json({
    defaultUiSessionId: "standalone",
    activeUiSessionId: "standalone",
    sessions: [
      {
        sessionId: "standalone",
        sessionUrl: `http://localhost:${PORT}/session/standalone`,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        waitingForFeedback: false,
        hasQueuedFeedback: false,
      },
    ],
  });
});

app.get("/session/:sessionId", (_req, res) => {
  res.type("html").send(
    FEEDBACK_HTML
      .replace("FEEDBACK_PATH", "in-memory feedback queue (non-persistent)")
      .replace("ACTIVE_SESSION_INFO", "Active session: standalone | Known sessions: 1")
  );
});

const setDefaultSessionHandler = (_req: express.Request, res: express.Response) => {
  res.json({ ok: true, defaultUiSessionId: "standalone", activeUiSessionId: "standalone" });
};

app.post("/sessions/default", setDefaultSessionHandler);
app.post("/sessions/active", setDefaultSessionHandler);

app.delete("/sessions/:sessionId", (_req, res) => {
  res.json({ ok: true });
});

app.post("/feedback", async (req, res) => {
  try {
    currentFeedback = typeof req.body === "string" ? req.body : req.body.content ?? "";
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.error(`Feedback UI running at http://localhost:${PORT}`);
});
