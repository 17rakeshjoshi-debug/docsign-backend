// Minimal backend: receives the signed doodle from the phone app,
// and serves it to the computer-side listener that talks to Bachin Draw.
//
// Run: npm install && node server.js

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const STORAGE_DIR = path.join(__dirname, "storage");
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const upload = multer({ dest: STORAGE_DIR });

// In-memory job list — swap for a real DB later, fine for getting this running now.
const jobs = {}; // documentId -> { status, imagePath, strokes, createdAt }

// 1) Phone app uploads the doodle-only (transparent) image here
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
    createdAt: new Date().toISOString(),
  };

  console.log(`Received signed document: ${documentId}`);
  res.json({ ok: true, documentId });
});

// 2) Computer-side listener polls this to find new jobs to send to Bachin Draw.
// Includes the raw strokes + page size directly so the listener can build G-code
// without a second round-trip.
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

// 3) Serves the actual signed image file for the listener to download
app.get("/api/documents/:id/image", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).end();
  res.sendFile(path.resolve(job.imagePath));
});

// 4) Listener calls this once it has handed the file to Bachin Draw
app.post("/api/documents/:id/ack", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.status = "sent_to_machine";
  console.log(`Document ${req.params.id} handed off to Bachin Draw`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
