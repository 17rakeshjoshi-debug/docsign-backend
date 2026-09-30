// Minimal backend: receives signed doodles and manages YouTube Live stream sync.
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const http = require("http");

const app = express();
const server = http.createServer(app);

// Native CORS middleware (no external package needed!)
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

const PORT = process.env.PORT || 3000;

const STORAGE_DIR = path.join(__dirname, "storage");
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const upload = multer({ dest: STORAGE_DIR });
const jobs = {}; 
let activeVideoId = ""; 

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
      "POST /api/live-stream/active-id",
      "GET /api/live-stream/active-id",
    ],
  });
});

// YouTube Live Stream Active ID Routes
app.post('/api/live-stream/active-id', (req, res) => {
    const { videoId } = req.body;
    if (videoId) {
        activeVideoId = videoId;
        console.log(`Active YouTube Live Stream ID updated: ${activeVideoId}`);
        res.status(200).json({ success: true, videoId: activeVideoId });
    } else {
        res.status(400).json({ error: "videoId is required" });
    }
});

app.get('/api/live-stream/active-id', (req, res) => {
    res.status(200).json({ videoId: activeVideoId });
});

// Document Workflow Routes
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
  console.log(`Document ${req.params.id} handed off to Machine`);
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

server.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
});