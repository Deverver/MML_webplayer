import * as Tone from "https://cdn.jsdelivr.net/npm/tone@next/+esm";

const melodyOnlySelect = document.getElementById("melody-only");
const melodyPlusSelect = document.getElementById("melody-plus-harmony");
const fullSongsSelect = document.getElementById("full-songs");

const playBtn = document.getElementById("play-btn");
const stopBtn = document.getElementById("stop-btn");
const volumeSlider = document.getElementById("volume");

let currentSong = null;
let synth = null;
let playing = false;
let activePart = null;

async function loadSongs() {
    const res = await fetch("/songs");
    const {melodyOnly, melodyPlusHarmony, fullSongs} = await res.json();

    // 1 method used to add data to all 3 selects separately
    function populateSelect(select, songs) {
        select.innerHTML = '<option value="">-- Select --</option>';
        songs.forEach((song, idx) => {
            const option = document.createElement("option");
            // Store the song object as JSON string
            option.value = JSON.stringify(song);
            option.textContent = song.title;
            select.appendChild(option);
        });
    }

    populateSelect(melodyOnlySelect, melodyOnly);
    populateSelect(melodyPlusSelect, melodyPlusHarmony);
    populateSelect(fullSongsSelect, fullSongs);
}

// Dropdown change listener.
const allDropdowns = [melodyOnlySelect, melodyPlusSelect, fullSongsSelect];

// For every select element inside allDropdowns.
// Listen for change and act on event.
allDropdowns.forEach(select => {
    select.addEventListener("change", () => {
        if (!select.value) {
            currentSong = null;
        } else {
            currentSong = JSON.parse(select.value);
            console.log("Selected song:", currentSong);
        }

        // Reset other dropdowns to default
        allDropdowns.forEach(otherSelect => {
            if (otherSelect !== select) {
                otherSelect.selectedIndex = 0;
            }
        });
    });
});

/** Data stored inside Songs is actually in MML (Music Macro Language) NOT Midi (Midi would be better for future sound engine work)
 *  Each song can have up to 3 tracks: melody, harmony1, harmony2.
 *  We have to parse each tracks data into structured "note data" as notes are very complex!
 *
 *  These are the key elements of MML data;
 *  v15 → set volume
 *  l32 → default note length
 *  c, d, e → note pitches
 *  & → tie notes
 *  > / < → octave shifts
 *  r → rest
 *
 *  All tracks are scheduled on the same Tone.js Transport using Tone.Part.
 *  This allows multiple tracks to play simultaneously while staying in sync,
 *  Synth triggers are only called for actual notes; rests are ignored. */
function parseMML(mml) {
    let octave = 4;
    let tempo = 120;
    let defaultLen = 4;
    const notes = [];

    const tokens = mml.match(/(t\d+|v\d+|l\d+|[<>]|r\d*|[a-gA-G]#?\d*)/g) || [];

    for (const token of tokens) {
        if (token.startsWith("t")) tempo = parseInt(token.slice(1));
        else if (token.startsWith("l")) defaultLen = parseInt(token.slice(1)) || defaultLen;
        else if (token === ">") octave++;
        else if (token === "<") octave--;
        else if (token.startsWith("r")) {
            const len = parseInt(token.slice(1)) || defaultLen;
            notes.push({note: null, duration: len});
        } else if (/[a-gA-G]/.test(token[0])) {
            const match = token.match(/([a-gA-G]#?)(\d+)?/);
            const pitch = match[1].toUpperCase();
            const len = match[2] ? parseInt(match[2]) : defaultLen;
            notes.push({note: `${pitch}${octave}`, duration: len});
        }
    }

    return {notes, tempo};
}

function noteLengthToSeconds(length, tempo) {
    const quarter = 60 / tempo;
    return (4 / length) * quarter;
}

// These "console.log"s are in the frontend, they can be seen in the web console
playBtn.addEventListener("click", async () => {
    if (!currentSong) {
        alert("Select a song first!");
        return;
    }

    // If something is already playing, stop it first
    if (playing) {
        stopPlayback();
    }

    await Tone.start();
    console.log("🔊 Audio context started");

    playing = true;

    // Setup volume
    const volDb = Tone.gainToDb(volumeSlider.value / 100);
    const volumeNode = new Tone.Volume(volDb).toDestination();

    // Create new synth instance
    synth = new Tone.Synth().connect(volumeNode);

    // Parse Melody
    const {notes, tempo} = parseMML(currentSong.melody);
    console.log("🎵 Parsed notes:", notes.length, "Tempo:", tempo);

    let time = 0;
    const events = [];

    for (const n of notes) {
        const dur = noteLengthToSeconds(n.duration, tempo);
        events.push({time, note: n.note, dur});
        time += dur;
    }

    activePart = new Tone.Part((time, ev) => {
        if (ev.note) synth.triggerAttackRelease(ev.note, ev.dur, time);
    }, events).start(0);

    Tone.Transport.start();
    Tone.Transport.scheduleOnce(() => stopPlayback(), time);

    console.log("▶️ Playback started");
});

stopBtn.addEventListener("click", stopPlayback);

function stopPlayback() {
    if (!playing) return;
    playing = false;

    Tone.Transport.stop();
    Tone.Transport.cancel();

    if (synth) synth.dispose();
    if (activePart) activePart.dispose();

    synth = null;
    activePart = null;

    console.log("⏹️ Playback stopped");
}

volumeSlider.addEventListener("input", () => {
    const volDb = Tone.gainToDb(volumeSlider.value / 100);
    if (synth) synth.volume.value = volDb;
});

loadSongs();
