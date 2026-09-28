// Minimal backend: receives the signed doodle from the phone app,
// serves it to the computer-side listener, and acts as a WebRTC signaling relay.
//
// Run: npm install express multer ws && node server.js

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "docsign-backend",
    routes: [
      "POST /api/documents/upload",
      "GET /api/documents/pending",
      "GET /api/documents/:id/image",
      "POST /api/documents/:id/ack",
      "POST /api/documents/:id/cancel",
      "POST /api/documents/:id/pause",
      "POST /api/documents/:id/resume",
      "GET /api/documents/:id/cancel-status",
      "POST /api/documents/:id/cancelled",
    ],
  });
});
const PORT = process.env.PORT || 3000;

const STORAGE_DIR = path.join(__dirname, "storage");
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const upload = multer({ dest: STORAGE_DIR });
const jobs = {}; 

app.post("/api/documents/upload", upload.single("doodleImage"), (req, res) => {
  const { documentId, strokes, pageWidthPts, pageHeightPts } = req.body;
  if (!documentId || !req.file) {
    return res.status(400).json({ error: "documentId and doodleImage are required" });
  }

  jobs[documentId] = {
    status: "pending_machine",
    imagePath: req.file.path,
    strokes: strokes ? JSON.parse(strokes) : [],
    pageWidthPts: Number(pageWidthPts) || 0,
    pageHeightPts: Number(pageHeightPts) || 0,
    cancelRequested: false,   
    pauseRequested: false,    
    createdAt: new Date().toISOString(),
  };

  console.log(`Received signed document: ${documentId}`);
  res.json({ ok: true, documentId });
});

app.get("/api/documents/pending", (req, res) => {
  const pending = Object.entries(jobs)
    .filter(([, job]) => job.status === "pending_machine")
    .map(([documentId, job]) => ({
      documentId,
      imageUrl: `/api/documents/${documentId}/image`,
      strokes: job.strokes,
      pageWidthPts: job.pageWidthPts,
      pageHeightPts: job.pageHeightPts,
      createdAt: job.createdAt,
    }));
  res.json(pending);
});

app.get("/api/documents/:id/image", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).end();
  res.sendFile(path.resolve(job.imagePath));
});

app.post("/api/documents/:id/ack", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.status = "sent_to_machine";
  console.log(`Document ${req.params.id} handed off to Bachin Draw`);
  res.json({ ok: true });
});

app.post("/api/documents/:id/cancel", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.cancelRequested = true;
  console.log(`Abort requested for document ${req.params.id}`);
  res.json({ ok: true });
});

app.post("/api/documents/:id/pause", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.pauseRequested = true;
  console.log(`Pause requested for document ${req.params.id}`);
  res.json({ ok: true });
});

app.post("/api/documents/:id/resume", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.pauseRequested = false;
  console.log(`Resume requested for document ${req.params.id}`);
  res.json({ ok: true });
});

app.get("/api/documents/:id/cancel-status", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  res.json({ cancelRequested: job.cancelRequested, pauseRequested: job.pauseRequested });
});

app.post("/api/documents/:id/cancelled", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.status = "cancelled";
  console.log(`Document ${req.params.id} was cancelled mid-signing`);
  res.json({ ok: true });
});

// WebRTC Signaling Relay & Command Bus
const peers = new Set();
wss.on("connection", (ws) => {
  peers.add(ws);
  ws.on("message", (message) => {
    // Relay SDP offers/answers and custom JSON commands like "capture"
    for (let peer of peers) {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) {
        peer.send(message.toString());
      }
    }
  });
  ws.on("close", () => peers.delete(ws));
});

server.listen(PORT, () => {
  console.log(`Backend and Signaling listening on port ${PORT}`);
});