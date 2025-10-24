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

// --- Audio Context + Master Volume ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);
// start at 50%
const initialVal = volumeSlider.value / 100;
masterGain.gain.value = Math.pow(initialVal, 2.5);


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

// --- MML Parsing ---
function parseMML(mml) {
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

            // Rests
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


// --- Load Songs ---
async function loadSongs() {
    try {
        const res = await fetch("/songs");
        const {melodyOnly, melodyPlusHarmony, fullSongs} = await res.json();

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

// --- Preload Instrument ---
async function preloadInstrument(name) {
    // Update: tried lower gain val (0.5) to prevent sound saturation in the compressors & masterGain
    // initial gain at 1 is fine for now as adjusting this value makes other controls harder to fine-tune
    // Major fix: setting destination to masterGain forces output directly into "context chain"
    return await Soundfont.instrument(audioCtx, name, {
        gain: 1,
        destination: masterGain
    });
}

// --- Stop Playback ---
function stopPlayback() {
    if (!playing) return;
    playing = false;
    scheduledNotes.forEach(n => {
        try { n.node.stop(); } catch {}
        if (n.noteGain) n.noteGain.disconnect();
    });
    scheduledNotes = [];
    console.log("⏹️ Playback stopped");

    // -- Track cleanup --
    if (instruments && Object.keys(instruments).length) {
        Object.values(instruments).forEach(inst => {
            if (inst.output) inst.output.disconnect();
        });
    }
}

// --- Volume Slider (smooth ramp) ---
// Update: volume controls work correctly after masterGain got routed correctly.
// Changed the slider values from being linear to exponential
// Issue: quick adjustments to the volume control still create audio "pops" even with a linearRamp
// Fix: not found
// Info: logarithmic math at 1.8 makes the volume about 1.6% when slider is at 10%, curve would be too aggressive
volumeSlider.addEventListener("input", () => {
    const linearVal = volumeSlider.value / 100;
    const perceptualGain = Math.pow(linearVal, 1.2); // limit range between 1 & 1.8

    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(perceptualGain, audioCtx.currentTime + 0.05);
});

// --- Dropdown Change ---
[melodyOnlySelect, melodyPlusSelect, fullSongsSelect].forEach(select => {
    select.addEventListener("change", () => {
        if (!select.value) currentSong = null;
        else currentSong = JSON.parse(select.value);
        [melodyOnlySelect, melodyPlusSelect, fullSongsSelect].forEach(other => {
            if (other !== select) other.selectedIndex = 0;
        });
    });
});

// --- Schedule Playback ---
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

    // Build and filter tracks
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

    // --- Create per-track GainNodes + mild compression ---
    const trackScale = 0.9 / tracks.length; // avoid clipping
    tracks.forEach(track => {
        // Per-track gain
        track.trackGain = audioCtx.createGain();
        track.trackGain.gain.value = trackScale;

        // -- Compressor --
        // After lowering the initial gain the compressor now needs to less aggressive
        // Changed values from [-3, 20, 4], this gives more control to the masterGain
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-12, audioCtx.currentTime);
        comp.knee.setValueAtTime(24, audioCtx.currentTime);
        comp.ratio.setValueAtTime(2, audioCtx.currentTime);

        comp.attack.setValueAtTime(0.01, audioCtx.currentTime);
        comp.release.setValueAtTime(0.25, audioCtx.currentTime);

        // Instrument → trackGain → compressor → masterGain → destination
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

        notes.forEach(n => {
            const durBeats = 4 / n.duration;
            const durSec = durBeats * (60 / globalTempo);
            const noteTime = startTime + beat * (60 / globalTempo);

            if (n.note) {
                const noteGain = audioCtx.createGain();
                const volGain = n.volume / 15; // This respects the mml v0-v15 sound volume
                noteGain.gain.value = volGain;

                // connect the individual note’s gain to the track gain
                noteGain.connect(track.trackGain);

                // FIX: direct Soundfont to output into noteGain
                const node = track.inst.play(n.note, noteTime, { duration: durSec, destination: noteGain });

                scheduledNotes.push({ node, noteGain, mmlVol: volGain });
            }

            beat += durBeats;
        });
    });

    console.log(`▶️ Playback started at tempo ${globalTempo} BPM`);
}

// --- Play / Stop Buttons ---
playBtn.addEventListener("click", schedulePlayback);
stopBtn.addEventListener("click", stopPlayback);

async function loadInstruments() {
    populateInstrumentSelect(melodyInstSelect);
    populateInstrumentSelect(harmony1InstSelect);
    populateInstrumentSelect(harmony2InstSelect);
}

// --- Initialize Page ---
async function renderPage() {
    await loadInstruments();
    await loadSongs();

    playBtn.disabled = false;
    stopBtn.disabled = false;
}

// --- Start App ---
renderPage();
