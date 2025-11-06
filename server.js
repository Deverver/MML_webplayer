// server.js
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./src/middleware/logger.js";
import errorHandler from './src/middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = express();
const PORT = 3000;

// --- Middleware ---
server.use(cors());
server.use(express.json());
server.use(logger);
server.use(errorHandler);

// --- Serve static files from /public ---
server.use(express.static(path.join(__dirname, "public")));

// --- Data files ---
const songsFile = path.join(__dirname, "src/data/songs.json");

// --- Helper to categorize songs ---
function getFilteredSongs() {
    const allSongs = JSON.parse(fs.readFileSync(songsFile, "utf-8"));

    // Add absolute index to each song
    allSongs.forEach((song, idx) => {
        song.index = idx;
    });

    const melodyOnly = [];
    const melodyPlusHarmony = [];
    const fullSongs = [];

    allSongs.forEach((song) => {
        const hasMelody = song.melody?.trim();
        const hasH1 = song.harmony1?.trim();
        const hasH2 = song.harmony2?.trim();
        if (!hasMelody) return; // Ignore songs with no melody

        if (hasMelody && !hasH1 && !hasH2) melodyOnly.push(song);
        else if (hasMelody && (hasH1 || hasH2) && !(hasH1 && hasH2)) melodyPlusHarmony.push(song);
        else if (hasMelody && hasH1 && hasH2) fullSongs.push(song);
    });

    return { melodyOnly, melodyPlusHarmony, fullSongs };
}

// --- API endpoints ---
server.get("/songs", (req, res) => {
    res.json(getFilteredSongs());
});

server.get("/songs/:index", (req, res) => {
    const allSongs = JSON.parse(fs.readFileSync(songsFile, "utf-8"));
    const song = allSongs[req.params.index];
    if (!song) return res.status(404).json({ error: "Song not found" });
    res.json(song);
});

// --- Start server ---
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
