// --- DOM Elements ---
const melodyOnlySelect = document.getElementById("melody-only");
const melodyPlusSelect = document.getElementById("melody-plus-harmony");
const fullSongsSelect = document.getElementById("full-songs");

const playBtn = document.getElementById("play-btn");
const stopBtn = document.getElementById("stop-btn");
const volumeSlider = document.getElementById("volume");

const melodyInstSelect = document.getElementById("melody-instrument");
const harmony1InstSelect = document.getElementById("harmony1-instrument");
const harmony2InstSelect = document.getElementById("harmony2-instrument");

// --- Audio Context ---
let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let masterGain = audioCtx.createGain();
masterGain.gain.value = volumeSlider.value / 100;
masterGain.connect(audioCtx.destination);

// --- State ---
let currentSong = null;
let instruments = {};
let scheduledNotes = [];
let playing = false;

// --- GM Instruments ---
const GM_INSTRUMENTS = [
    "acoustic_grand_piano", "bright_acoustic_piano", "electric_piano_1",
    "electric_piano_2", "harpsichord", "acoustic_guitar_nylon",
    "acoustic_guitar_steel", "electric_guitar_clean", "overdriven_guitar",
    "distortion_guitar", "violin", "cello", "string_ensemble_1",
    "choir_aahs", "flute", "trumpet", "trombone", "clarinet",
    "french_horn", "sax_alto", "banjo", "harmonica", "sitar"
];

// --- Populate instrument selects ---
function populateInstrumentSelect(select) {
    select.innerHTML = "";
    GM_INSTRUMENTS.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name.replace(/_/g, " ");
        select.appendChild(opt);
    });
    select.value = "acoustic_grand_piano";
}


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
 *  Before when this project used "npm/tone@next/+esm" track were all scheduled separately, but all played at once via Transport using Tone.Part.
 *  This allowed for multiple tracks to play simultaneously while staying in sync
 *
 *  This Project now uses "npm/soundfont-player@0.12.0/dist/soundfont-player.js"
 *  Which does allow for simultaneous track playing natively,
 *  the "playBtn" function has been renamed to "Schedule Playback", since we now have to schedule and control tracks separately.
 *  While this allows for greater control of each track, it also means more complexity, as elements like volume gain now has a hierarchical structure.
 *
 *  I have tried to control the volume in this manner, seen from the input side;
 *  Volume slider -> MasterGain -> CompressorGain -> Individual Tracks -> Instrument type.
 *  But so far volume control has been rather unresponsive, the hierarchy is likely the culprit.
 *  */
// --- MML Parsing ---
function parseMML(mml) {
    // Standard settings for notes, set in case MML key elements are not defined.
    let octave = 4;
    let tempo = 120;
    let defaultLen = 4;
    let currentVol = 15;
    const notes = [];

    // Tokenize notes
    const tokens = mml.match(/(t\d+|v\d+|l\d+|[<>]|r\d*\.?|[a-gA-G]#?\d*\.?)/g) || [];
    for (const token of tokens) {
        if (token.startsWith("t")) tempo = parseInt(token.slice(1));
        else if (token.startsWith("l")) defaultLen = parseInt(token.slice(1)) || defaultLen;
        else if (token.startsWith("v")) currentVol = parseInt(token.slice(1));
        else if (token === ">") octave++;
        else if (token === "<") octave--;
        else if (token.startsWith("r")) {

            // Rests + Short Notes
            // Had to add "." to the regex filter, as shorter notes would interweave and cause time drift in tracks.
            const match = token.match(/r(\d+)?(\.)?/);
            const len = match[1] ? parseInt(match[1]) : defaultLen;
            const dotted = !!match[2];
            let duration = len;
            if (dotted) duration *= 1.5;
            notes.push({note: null, duration, volume: currentVol});
        } else if (/[a-gA-G]/.test(token[0])) {

            // Notes
            const match = token.match(/([a-gA-G]#?)(\d+)?(\.)?/);
            const pitch = match[1].toUpperCase();
            const len = match[2] ? parseInt(match[2]) : defaultLen;
            const dotted = !!match[3];
            let duration = len;
            if (dotted) duration *= 1.5;
            notes.push({note: `${pitch}${octave}`, duration, volume: currentVol});
        }
    }
    return {notes, tempo};
}

function noteLengthToSeconds(length, tempo) {
    return (4 / length) * (60 / tempo);
}

// --- Load Songs ---
async function loadSongs() {
    try {
        const res = await fetch("/songs");
        const {melodyOnly, melodyPlusHarmony, fullSongs} = await res.json();

        // 1 method used to add option data to all 3 select elements separately
        function populateSelect(select, songs) {
            select.innerHTML = '<option value="">-- Select --</option>';
            songs.forEach(song => {
                const option = document.createElement("option");
                option.value = JSON.stringify(song);
                option.textContent = song.title;
                select.appendChild(option);
            });
        }

        populateSelect(melodyOnlySelect, melodyOnly);
        populateSelect(melodyPlusSelect, melodyPlusHarmony);
        populateSelect(fullSongsSelect, fullSongs);
        console.log("Songs loaded successfully.");
    } catch (err) {
        console.error("Failed to load songs:", err);
    }
}

// --- Preload Instrument (Helper) ---
async function preloadInstrument(name) {
    return await Soundfont.instrument(audioCtx, name, {gain: 1});
}

// --- Function Call load Instrument (Render) ---
async function loadInstruments() {
    populateInstrumentSelect(melodyInstSelect);
    populateInstrumentSelect(harmony1InstSelect);
    populateInstrumentSelect(harmony2InstSelect);
}

// --- Stop Playback (UI Event) ---
function stopPlayback() {
    if (!playing) return;
    playing = false;
    scheduledNotes.forEach(n => {
        try {
            n.node.stop();
        } catch {
        }
    });
    scheduledNotes = [];
    console.log("⏹️ Playback stopped");
}

// --- Volume Slider (True Mute + Realtime Volume) (UI Event) ---
// Do not know why but every iteration of this just does not work,
// Hypothesis is that generated sound from SoundFonts has an interval gain val.
volumeSlider.addEventListener("input", () => {
    const sliderGain = volumeSlider.value / 100;
    if (sliderGain === 0) {
        masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    }
    masterGain.gain.linearRampToValueAtTime(sliderGain, audioCtx.currentTime + 0.05);
});

// --- Song Dropdown Listener ---
[melodyOnlySelect, melodyPlusSelect, fullSongsSelect].forEach(select => {
    select.addEventListener("change", () => {
        if (!select.value) currentSong = null;
        else currentSong = JSON.parse(select.value);
        [melodyOnlySelect, melodyPlusSelect, fullSongsSelect].forEach(other => {
            if (other !== select) other.selectedIndex = 0;
        });
    });
});

// --- Schedule Playback (UI Event) ---
async function schedulePlayback() {
    if (!currentSong) {
        alert("Select a song first!");
        return;
    }
    if (playing) stopPlayback();
    playing = true;

    if (audioCtx.state === "suspended") await audioCtx.resume();

    // Preload instruments
    instruments.melody = await preloadInstrument(melodyInstSelect.value);
    instruments.harmony1 = await preloadInstrument(harmony1InstSelect.value);
    instruments.harmony2 = await preloadInstrument(harmony2InstSelect.value);

    // Build and filter tracks separately
    const tracks = [
        {data: currentSong.melody, inst: instruments.melody},
        {data: currentSong.harmony1, inst: instruments.harmony1},
        {data: currentSong.harmony2, inst: instruments.harmony2}
    ].filter(t => t.data);

    scheduledNotes = [];

    // --- Determine global tempo ---
    let globalTempo = 120;
    for (const t of tracks) {
        const {tempo} = parseMML(t.data);
        if (tempo) {
            globalTempo = tempo;
            break;
        }
    }

    // --- Create per-track GainNodes + Mild Compression ---
    const trackScale = 0.9 / tracks.length; // avoid clipping
    tracks.forEach(track => {

        // Per-track gain
        track.trackGain = audioCtx.createGain();
        track.trackGain.gain.value = trackScale;

        // Compression should "smooth out" high notes, especially when same type instruments are played simultaneously.
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-3, audioCtx.currentTime);
        comp.knee.setValueAtTime(20, audioCtx.currentTime);
        comp.ratio.setValueAtTime(4, audioCtx.currentTime);
        comp.attack.setValueAtTime(0.01, audioCtx.currentTime);
        comp.release.setValueAtTime(0.25, audioCtx.currentTime);

        // Volume control seen from the output side;
        // Instrument → individual track → compressor → masterGain → destination
        track.trackGain.connect(comp);
        comp.connect(masterGain);

        // For safety, store comp if you want to tweak later
        track.comp = comp;
    });

    const startTime = audioCtx.currentTime;

    // --- Schedule Notes per track ---
    tracks.forEach(track => {
        const {notes} = parseMML(track.data);
        let beat = 0;

        notes.forEach(noteObj => {
            // --- This section should  ---
            const durBeats = 4 / noteObj.duration;
            const durSec = durBeats * (60 / globalTempo);
            const noteTime = startTime + beat * (60 / globalTempo);

            if (noteObj.note) {
                const noteGain = audioCtx.createGain();
                const volGain = noteObj.volume / 15;
                noteGain.gain.value = volGain;

                // connect the note’s gain to the track gain
                noteGain.connect(track.trackGain);

                // 🔥 FIX: direct Soundfont to output into noteGain
                const node = track.inst.play(noteObj.note, noteTime, {duration: durSec, destination: noteGain});

                scheduledNotes.push({node, noteGain, mmlVol: volGain});
            }

            beat += durBeats;
        });
    });

    console.log(`▶️ Playback started at tempo ${globalTempo} BPM`);
}

// --- Play / Stop Buttons ---
playBtn.addEventListener("click", schedulePlayback);
stopBtn.addEventListener("click", stopPlayback);

// --- Initialize Page ---
async function renderPage() {
    await loadInstruments();
    await loadSongs();

    // Do not know why this was recommended to do, it obv. enables event interactions
    playBtn.disabled = false;
    stopBtn.disabled = false;
}

// --- Start App ---
renderPage();
