// Minimal backend: receives the signed doodle from the phone app,
// and serves it to the computer-side listener that talks to Bachin Draw.
//
// Run: npm install && node server.js

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000; // Render assigns its own PORT — 3000 is only for running locally

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
    cancelRequested: false,   // set by /abort (the actual "stop and go home")
    pauseRequested: false,    // set by /pause — pen stops exactly where it is, no reset
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

// 5) Phone app calls this when the user taps Cancel from the pause screen —
// this is the ACTUAL abort: listener soft-resets the machine, clears the
// resulting GRBL alarm, and sends the pen back to the origin.
app.post("/api/documents/:id/cancel", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.cancelRequested = true;
  console.log(`Abort requested for document ${req.params.id}`);
  res.json({ ok: true });
});

// 5b) Phone app calls this when the user taps Cancel DURING signing — this
// just pauses: the listener stops sending further G-code lines, leaving
// the pen exactly where the last completed motion left it. No reset.
app.post("/api/documents/:id/pause", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.pauseRequested = true;
  console.log(`Pause requested for document ${req.params.id}`);
  res.json({ ok: true });
});

// 5c) Phone app calls this when the user taps "Continue Signing" on the
// pause screen — clears the pause flag so the listener resumes sending
// the remaining lines from exactly where it stopped.
app.post("/api/documents/:id/resume", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.pauseRequested = false;
  console.log(`Resume requested for document ${req.params.id}`);
  res.json({ ok: true });
});

// 6) Listener polls this (in the background, WHILE a job is being drawn)
// to check whether a pause or an abort was requested mid-signing.
app.get("/api/documents/:id/cancel-status", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  res.json({ cancelRequested: job.cancelRequested, pauseRequested: job.pauseRequested });
});

// 7) Listener calls this if a job was actually stopped partway through
app.post("/api/documents/:id/cancelled", (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: "not found" });
  job.status = "cancelled";
  console.log(`Document ${req.params.id} was cancelled mid-signing`);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
