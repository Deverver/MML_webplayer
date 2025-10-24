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
/*  The official 128 + Extra
    percussion/FX instruments are appended at the end of many Soundfont collections.
    breath_noise, seashore, bird_tweet, telephone_ring, helicopter, applause, gunshot. */
const GM_INSTRUMENTS = [
    "acoustic_grand_piano", "bright_acoustic_piano", "electric_grand_piano",
    "honky_tonk_piano", "electric_piano_1", "electric_piano_2", "harpsichord",
    "clavinet", "celesta", "glockenspiel", "music_box", "vibraphone", "marimba",
    "xylophone", "tubular_bells", "dulcimer", "drawbar_organ", "percussive_organ",
    "rock_organ", "church_organ", "reed_organ", "accordion", "harmonica", "bandoneon",
    "tango_accordion", "acoustic_guitar_nylon", "acoustic_guitar_steel", "electric_guitar_clean",
    "electric_guitar_muted", "overdriven_guitar", "distortion_guitar", "guitar_harmonics",
    "acoustic_bass", "electric_bass_finger", "electric_bass_pick", "fretless_bass",
    "slap_bass_1", "slap_bass_2", "synth_bass_1", "synth_bass_2", "violin", "viola",
    "cello", "contrabass", "tremolo_strings", "pizzicato_strings", "orchestral_harp",
    "timpani", "string_ensemble_1", "string_ensemble_2", "string_ensemble_3",
    "synth_strings_1", "synth_strings_2", "choir_aahs", "voice_oohs", "synth_choir",
    "orchestra_hit", "trumpet", "trombone", "tuba", "muted_trumpet", "french_horn",
    "brass_ensemble_1", "brass_ensemble_2", "synth_brass_1", "synth_brass_2", "soprano_sax",
    "alto_sax", "tenor_sax", "baritone_sax", "oboe", "english_horn", "bassoon", "clarinet",
    "piccolo", "flute", "recorder", "pan_flute", "blown_bottle", "shakuhachi", "whistle",
    "ocarina", "lead_1_square", "lead_2_sawtooth", "lead_3_calliope", "lead_4_chiff",
    "lead_5_charang", "lead_6_voice", "lead_7_fifths", "lead_8_bass_lead", "pad_1_new_age",
    "pad_2_warm", "pad_3_polysynth", "pad_4_choir", "pad_5_bowed", "pad_6_metallic",
    "pad_7_halo", "pad_8_sweep", "fx_1_rain", "fx_2_soundtrack", "fx_3_crystal",
    "fx_4_atmosphere", "fx_5_brightness", "fx_6_goblins", "fx_7_echoes", "fx_8_scifi",
    "sitar", "banjo", "shamisen", "koto", "kalimba", "bagpipe", "fiddle", "shanai",
    "tinkle_bell", "agogo", "steel_drums", "woodblock", "taiko_drum", "melodic_tom",
    "synth_drum", "reverse_cymbal", "guitar_fret_noise", "breath_noise", "seashore",
    "bird_tweet", "telephone_ring", "helicopter", "applause", "gunshot"
];

// --- Populate instrument selects ---
function populateInstrumentSelect(select) {
    select.innerHTML = "";
    GM_INSTRUMENTS.forEach((name, index) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = `${index + 1}. ${name.replace(/_/g, " ")}`;
        select.appendChild(opt);
    });
    select.value = "acoustic_grand_piano";
}

// --- MML Parsing ---
function parseMML(mml) {
    // initial state
    let octave = 4;
    let tempo = 120;
    let defaultLen = 4;    // denominator: l4 = quarter note
    let currentVol = 15;
    const notes = [];

    if (!mml || typeof mml !== "string") return {notes, tempo};

    // Tokenizer: supports t#, v#, l#, o#, > < & rests r#, dotted .,
    // and note tokens like a, a+, a#, a- optionally followed by length digits and optional dot
    const tokenRegex = /(t\d+|v\d+|l\d+|o\d+|[<>]|&|r\d*\.?|[a-gA-G][\+#-]?\d*\.?)/g;
    const tokens = mml.match(tokenRegex) || [];

    // Helper to parse a single note token (e.g., "c+8.", "d4", "e.")
    function parseNoteToken(tok) {
        // tok examples: "c", "c+", "c+8", "c+8."
        const m = tok.match(/^([a-gA-G])([\+#-]?)(\d+)?(\.)?$/);
        if (!m) return null;
        const letter = m[1].toUpperCase();
        const accidental = m[2]; // '#', '+', '-' or ''
        const len = m[3] ? parseInt(m[3], 10) : defaultLen;
        const dotted = !!m[4];
        // normalize accidentals: treat '+' as '#'
        const acc = accidental === '+' ? '#' : accidental;
        return {letter, acc, len, dotted};
    }

    // iterate tokens with ability to look ahead (for ties)
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.startsWith("t")) {
            tempo = parseInt(token.slice(1), 10) || tempo;
            continue;
        }
        if (token.startsWith("l")) {
            defaultLen = parseInt(token.slice(1), 10) || defaultLen;
            continue;
        }
        if (token.startsWith("v")) {
            currentVol = parseInt(token.slice(1), 10);
            if (isNaN(currentVol)) currentVol = 15;
            continue;
        }
        if (token.startsWith("o")) {
            octave = parseInt(token.slice(1), 10) || octave;
            continue;
        }
        if (token === ">") {
            octave++;
            continue;
        }
        if (token === "<") {
            octave--;
            continue;
        }

        // Rests: r, r4, r8. etc. (store duration in beats)
        if (token.startsWith("r")) {
            const m = token.match(/^r(\d+)?(\.)?$/);
            const len = m && m[1] ? parseInt(m[1], 10) : defaultLen;
            const dotted = !!(m && m[2]);
            let beats = 4 / len;
            if (dotted) beats *= 1.5;
            notes.push({note: null, duration: beats, volume: currentVol});
            continue;
        }

        // Notes (maybe tied)
        const noteParsed = parseNoteToken(token);
        if (noteParsed) {
            // compute beats for first note
            let totalBeats = 4 / noteParsed.len;
            if (noteParsed.dotted) totalBeats *= 1.5;

            // build pitch (letter + accidental + octave)
            const pitch = noteParsed.letter + (noteParsed.acc || "") + octave;

            // look ahead for ties: token sequence is: note & note & note ...
            // we only merge ties when subsequent tied note has the same letter+accidental
            let lookIndex = i + 1;
            while (lookIndex < tokens.length && tokens[lookIndex] === "&" && (lookIndex + 1) < tokens.length) {
                const nextTok = tokens[lookIndex + 1];
                const nextNoteParsed = parseNoteToken(nextTok);
                if (!nextNoteParsed) break;
                if (nextNoteParsed.letter.toUpperCase() === noteParsed.letter.toUpperCase()
                    && ((nextNoteParsed.acc || "") === (noteParsed.acc || ""))) {
                    // add its beats
                    let addBeats = 4 / nextNoteParsed.len;
                    if (nextNoteParsed.dotted) addBeats *= 1.5;
                    totalBeats += addBeats;
                    // consume the & and the next note token
                    lookIndex += 2;
                } else {
                    // not same pitch — stop tie chain
                    break;
                }
            }

            // advance the main index to the last consumed token in tie chain
            i = lookIndex - 1;

            notes.push({
                note: pitch,
                duration: totalBeats,  // stored in beats
                volume: currentVol
            });

            continue;
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
        try {
            if (n.node && typeof n.node.stop === "function") n.node.stop();
        } catch {
        }
        if (n.noteGain) {
            try {
                n.noteGain.disconnect();
            } catch (e) {
            }
        }
    });
    scheduledNotes = [];
    console.log("⏹️ Playback stopped");

    // -- Track cleanup --
    if (instruments && Object.keys(instruments).length) {
        Object.values(instruments).forEach(inst => {
            if (inst && inst.output) {
                try {
                    inst.output.disconnect();
                } catch (e) {
                }
            }
        });
    }
}

// --- Volume Slider (smooth ramp) ---
volumeSlider.addEventListener("input", () => {
    const linearVal = volumeSlider.value / 100;
    const perceptualGain = Math.pow(linearVal, 1.2); // user-tuned
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
    instruments.melody = currentSong.melody ? await preloadInstrument(melodyInstSelect.value) : null;
    instruments.harmony1 = currentSong.harmony1 ? await preloadInstrument(harmony1InstSelect.value) : null;
    instruments.harmony2 = currentSong.harmony2 ? await preloadInstrument(harmony2InstSelect.value) : null;

    // Build and filter tracks
    const tracks = [
        {data: currentSong.melody, inst: instruments.melody},
        {data: currentSong.harmony1, inst: instruments.harmony1},
        {data: currentSong.harmony2, inst: instruments.harmony2}
    ].filter(t => t.data && t.inst);

    scheduledNotes = [];

    // --- Determine global tempo ---
    let globalTempo = 120;
    for (const t of tracks) {
        const parsed = parseMML(t.data);
        if (parsed && parsed.tempo) {
            globalTempo = parsed.tempo;
            break;
        }
    }

    // --- Create per-track GainNodes + mild compression ---
    const trackScale = 0.9 / Math.max(tracks.length, 1); // avoid clipping
    tracks.forEach(track => {
        // Per-track gain
        track.trackGain = audioCtx.createGain();
        track.trackGain.gain.value = trackScale;

        // -- Compressor --
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-12, audioCtx.currentTime);
        comp.knee.setValueAtTime(24, audioCtx.currentTime);
        comp.ratio.setValueAtTime(2, audioCtx.currentTime);
        comp.attack.setValueAtTime(0.01, audioCtx.currentTime);
        comp.release.setValueAtTime(0.25, audioCtx.currentTime);

        // Instrument → trackGain → compressor → masterGain → destination
        track.trackGain.connect(comp);
        comp.connect(masterGain);

        // store comp for later tweak
        track.comp = comp;
    });

    const startTime = audioCtx.currentTime;
    const beatSec = (60 / globalTempo); // seconds per beat (quarter note)

    // --- Schedule Notes per track ---
    tracks.forEach(track => {
        const parsed = parseMML(track.data);
        const {notes} = parsed;
        let timeSec = startTime; // absolute time for this track's next note

        for (const n of notes) {
            // n.duration is in beats (as produced by parseMML)
            const durSec = n.duration * beatSec;

            if (n.note) {
                // connect the individual note’s gain to the track gain
                const noteGain = audioCtx.createGain();
                const volGain = (n.volume || 15) / 15; // This respects the mml v0-v15 sound volume
                noteGain.gain.value = volGain;
                noteGain.connect(track.trackGain);

                // schedule note: timeSec is absolute audioCtx time in seconds
                const node = track.inst.play(n.note, timeSec, {duration: durSec, destination: noteGain});

                scheduledNotes.push({node, noteGain, mmlVol: volGain});

                // -- schedule cleanup --
                (function (g, t) {
                    const cleanupDelay = (t + 0.3) * 1000;
                    setTimeout(() => {
                        try {
                            g.disconnect();
                        } catch (e) {
                        }
                    }, cleanupDelay);
                })(noteGain, durSec);
            }

            timeSec += durSec;
        }
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
