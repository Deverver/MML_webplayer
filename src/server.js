import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {logger} from './middleware/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = express();
const PORT = 3000;

server.use(cors());
server.use(express.json());
server.use(express.static(path.join(__dirname, "../public")));
server.use(logger);


const songsFile = path.resolve(__dirname, "./data/songs.json");

/**
 * Helper: Filter valid songs
 */
function getFilteredSongs() {
    const allSongs = JSON.parse(fs.readFileSync(songsFile, "utf-8"));

    const melodyOnly = [];
    const melodyPlusHarmony = [];
    const fullSongs = [];

    allSongs.forEach(song => {
        const hasMelody = song.melody && song.melody.trim() !== "";
        const hasH1 = song.harmony1 && song.harmony1.trim() !== "";
        const hasH2 = song.harmony2 && song.harmony2.trim() !== "";

        if (!hasMelody) return; // Skip songs without melody

        if (hasMelody && !hasH1 && !hasH2) {
            melodyOnly.push(song);
        } else if (hasMelody && (hasH1 || hasH2) && !(hasH1 && hasH2)) {
            melodyPlusHarmony.push(song);
        } else if (hasMelody && hasH1 && hasH2) {
            fullSongs.push(song);
        }
    });

    return { melodyOnly, melodyPlusHarmony, fullSongs };
}

// Send categorized songs
server.get("/songs", (req, res) => {
    const categorized = getFilteredSongs();
    res.json(categorized);
});

// Individual song route
server.get("/songs/:index", (req, res) => {
    const allSongs = JSON.parse(fs.readFileSync(songsFile, "utf-8"));
    const song = allSongs[req.params.index];
    if (!song) return res.status(404).json({ error: "Song not found" });
    res.json(song);
});

server.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
