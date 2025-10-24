/**
 *  DO NOT RUN THIS AGAIN!!!!
 *  IT HAS ALREADY BEEN RUN ONCE
 *  IT DOES NOT NEED TO BE RUN ANYMORE!!!!
 * */

import fs from "fs";
import path from "path";

const inputDir = path.resolve("./txt_songs");
const outputFile = path.resolve("./songs.json");

// --- In case no folder are present ---
if (!fs.existsSync(inputDir)) {
    fs.mkdirSync(inputDir, {recursive: true});
    console.log(`Created folder: ${inputDir}`);
    console.log("Please add some .txt song files, then rerun this script.");
    process.exit(0);
}

// --- Parser for the .txt file data ---
function parseSongText(content) {
    const lines = content.split("\n").map(line => line.trim()).filter(Boolean);
    const song = {};

    for (const line of lines) {
        const [key, ...rest] = line.split(":");
        if (!key || !rest.length) continue;
        const value = rest.join(":").trim();

        // Field mapping
        switch (key.toLowerCase()) {
            case "song title":
                song.title = value;
                break;
            case "composer":
                song.composer = value;
                break;
            case "rank":
                song.rank = value;
                break;
            case "instrument":
                song.instrument = value;
                break;
            case "melody":
                song.melody = value;
                break;
            case "harmony 1":
                song.harmony1 = value;
                break;
            case "harmony 2":
                song.harmony2 = value;
                break;
            default:
                break;
        }
    }

    return song;
}

// Another FS option is "readdirSync"; this returns a list of all filenames inside a directory!
// Using .filter makes the "search" only include files ending with ".txt".
function readAllSongs() {
    const files = fs.readdirSync(inputDir).filter(file => file.endsWith(".txt"));
    const songs = [];

    for (const file of files) {
        const filePath = path.join(inputDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = parseSongText(content);
        songs.push(parsed);
    }

    return songs;
}

const allSongs = readAllSongs();
fs.writeFileSync(outputFile, JSON.stringify(allSongs, null, 2));
console.log(`✅ Saved ${allSongs.length} songs to ${outputFile}`);
