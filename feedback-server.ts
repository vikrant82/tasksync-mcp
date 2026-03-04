#!/usr/bin/env node
/**
 * Standalone feedback web UI for TaskSync MCP.
 * Serves a form at http://localhost:PORT that writes to feedback.md.
 * 
 * Usage: node dist/feedback-server.js [--port=PORT] [feedback-file-path]
 * Default: port 3456, feedback file ./feedback.md
 */

import express from "express";
import fs from "fs/promises";
import path from "path";
import { FEEDBACK_HTML } from './feedback-html.js';

const args = process.argv.slice(2);
const portArg = args.find(a => a.startsWith("--port="));
const positionalArgs = args.filter(a => !a.startsWith("--"));
const PORT = parseInt(portArg?.split("=")[1] || process.env.FEEDBACK_PORT || "3456");
const feedbackPath = path.resolve(positionalArgs[0] || "feedback.md");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Ensure feedback file exists
async function ensureFeedbackFile() {
  try {
    await fs.access(feedbackPath);
  } catch {
    await fs.mkdir(path.dirname(feedbackPath), { recursive: true });
    await fs.writeFile(feedbackPath, "", "utf-8");
  }
}

app.get("/", (_req, res) => {
  res.type("html").send(FEEDBACK_HTML.replace("FEEDBACK_PATH", feedbackPath));
});

app.get("/feedback", async (_req, res) => {
  try {
    const content = await fs.readFile(feedbackPath, "utf-8");
    res.type("text").send(content);
  } catch {
    res.type("text").send("");
  }
});

app.post("/feedback", async (req, res) => {
  try {
    const content = typeof req.body === "string" ? req.body : (req.body.content ?? "");
    await fs.writeFile(feedbackPath, content, "utf-8");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

async function main() {
  await ensureFeedbackFile();
  app.listen(PORT, () => {
    console.error(`Feedback UI running at http://localhost:${PORT}`);
    console.error(`Writing to: ${feedbackPath}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
