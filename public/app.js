// --- Song Player Area ---
// -- Song Objects --
const melodyOnlySelect = document.getElementById("melody-only");
const melodyPlusSelect = document.getElementById("melody-plus-harmony");
const fullSongsSelect = document.getElementById("full-songs");

// -- Song Instruments --
const melodyInstSelect = document.getElementById("melody-instrument");
const harmony1InstSelect = document.getElementById("harmony1-instrument");
const harmony2InstSelect = document.getElementById("harmony2-instrument");

// -- Song Controls --
const playBtn = document.getElementById("play-btn");
const stopBtn = document.getElementById("stop-btn");
const volumeSlider = document.getElementById("volume");

// --- Audio Context + Master Volume ---
// This controls all other audio outputs
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);
// start at 50%
const initialVal = volumeSlider.value / 100;
masterGain.gain.value = Math.pow(initialVal, 2.5);

// --- Song Player State ---
let currentSong = null;
let instruments = {};
let scheduledNotes = [];
let playing = false;

// --- GM Instruments ---
/* "General Midi" instruments supplied from soundfont-player v0.12.0 by danigb */
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
    "timpani", "string_ensemble_1", "string_ensemble_2", "synth_strings_1", "synth_strings_2",
    "choir_aahs", "voice_oohs", "synth_choir", "orchestra_hit", "trumpet", "trombone", "tuba",
    "muted_trumpet", "french_horn", "brass_ensemble_1", "brass_ensemble_2", "synth_brass_1",
    "synth_brass_2", "soprano_sax", "alto_sax", "tenor_sax", "baritone_sax", "oboe", "english_horn",
    "bassoon", "clarinet", "piccolo", "flute", "recorder", "pan_flute", "blown_bottle", "shakuhachi",
    "whistle", "ocarina", "lead_1_square", "lead_2_sawtooth", "lead_3_calliope", "lead_4_chiff",
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

    // -- Expanded Tokenizer --
    // Supports t#, v#, l#, o#, > < & rests r#, dotted ., and note tokens like a, a+, a#, a-
    const tokenRegex = /(t\d+|v\d+|l\d+|o\d+|[<>]|&|r\d*\.?|[a-gA-G][\+#-]?\d*\.?)/g;
    const tokens = mml.match(tokenRegex) || [];

    // -- Single note corrective parser (helper) --
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

    // Iterate over tokens with ability to look ahead for "ties" or "long notes"
    // This is entire rework is want I wanted to avoid
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

        // Rests: r, r4, r8. etc. REWORK: Everything has to be by Beat now.
        if (token.startsWith("r")) {
            const m = token.match(/^r(\d+)?(\.)?$/);
            const len = m && m[1] ? parseInt(m[1], 10) : defaultLen;
            const dotted = !!(m && m[2]);
            let beats = 4 / len;
            if (dotted) beats *= 1.5;
            notes.push({note: null, duration: beats, volume: currentVol});
            continue;
        }

        // Notes Re: now includes tied notes
        const parsedNote = parseNoteToken(token);
        if (parsedNote) {
            // compute beats for first note
            let totalBeats = 4 / parsedNote.len;
            if (parsedNote.dotted) totalBeats *= 1.5;

            // build pitch (letter + accidental + octave)
            const pitch = parsedNote.letter + (parsedNote.acc || "") + octave;

            // look ahead for ties: token sequence is: note & note & note ...
            // we only merge ties when subsequent tied note has the same letter+accidental
            let lookIndex = i + 1;
            while (lookIndex < tokens.length && tokens[lookIndex] === "&" && (lookIndex + 1) < tokens.length) {
                const nextTok = tokens[lookIndex + 1];
                const nextNoteParsed = parseNoteToken(nextTok);
                if (!nextNoteParsed) break;
                if (nextNoteParsed.letter.toUpperCase() === parsedNote.letter.toUpperCase()
                    && ((nextNoteParsed.acc || "") === (parsedNote.acc || ""))) {
                    // Add beats up to preserve note time
                    let addBeats = 4 / nextNoteParsed.len;
                    if (nextNoteParsed.dotted) addBeats *= 1.5;
                    totalBeats += addBeats;
                    // Consume the & and the next note token
                    lookIndex += 2;
                } else {
                    // If notes are not the same pitch — stop tie chain
                    break;
                }
            }
            // Advance index to last consumed token
            i = lookIndex - 1;

            notes.push({
                note: pitch,
                duration: totalBeats,  // stored in beats
                volume: currentVol
            });
        }
    }

    return {notes, tempo};
}

// --- Load Songs ---
async function loadSongs() {
    try {
        const res = await fetch("/songs");
        const {melodyOnly, melodyPlusHarmony, fullSongs} = await res.json();

        async function populateSelect(select, songs) {
            select.innerHTML = '<option value="">-- Select --</option>';
            songs.forEach(song => {
                const option = document.createElement("option");
                option.className = 'song-option'
                option.value = JSON.stringify(song);
                option.textContent = song.title;
                select.appendChild(option);
            })
        }

        await populateSelect(melodyOnlySelect, melodyOnly);
        await populateSelect(melodyPlusSelect, melodyPlusHarmony);
        await populateSelect(fullSongsSelect, fullSongs);
        console.log("Songs loaded successfully.");
    } catch (err) {
        console.error("Failed to load songs:", err);
    }
}


/* Some instruments fail to "fetch", don't know how to handle this as it is not an actual fetch request
if it were then something like this could have been used
fetch(url).then((response) => {
  if (response.ok) {
    return response.json();
  }
  throw new Error('Something went wrong'); // Or alert
})
.then((responseJson) => {
  // Do something with the response
})
.catch((error) => {
  console.log(error)
});

*/

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
    const perceptualGain = Math.pow(linearVal, 1.2); // Keep between 1 & 1.8
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
    ].filter(track => track.data && track.inst);

    scheduledNotes = [];

    // --- Determine global tempo ---
    let globalTempo = 120;
    for (const track of tracks) {
        const parsed = parseMML(track.data);
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

        // Intended output chain:
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
            // n.duration is in beats (from parseMML)
            const durSec = n.duration * beatSec;

            if (n.note) {
                // Connect each individual note’s gain to the track gain
                const noteGain = audioCtx.createGain();
                const volGain = (n.volume || 15) / 15; // This respects the mml v0-v15 sound volume
                noteGain.gain.value = volGain;
                noteGain.connect(track.trackGain);

                // Schedule note: timeSec is absolute audioCtx time in seconds
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
playBtn.addEventListener("click", await schedulePlayback);
stopBtn.addEventListener("click", stopPlayback);

async function loadInstruments() {
    populateInstrumentSelect(melodyInstSelect);
    populateInstrumentSelect(harmony1InstSelect);
    populateInstrumentSelect(harmony2InstSelect);
}

// --- EXPERIMENTAL SECTION CONTAINS LARGE AMOUNTS OF DUPLICATED CODE, Routing a service for this is likely needed ---

// --- MML Editor Area ---
// -- Editor DOM --
const editorInputs = [
    document.getElementById("editor-track1"),
    document.getElementById("editor-track2"),
    document.getElementById("editor-track3")
];

// -- Editor Controls --
const previewBtn = document.getElementById("preview-editor");
const stopEditorBtn = document.getElementById("stop-editor");
const clearEditorBtn = document.getElementById("clear-editor");

// -- Editor State
let editorInstruments = {};
let editorScheduledNotes = [];
let editorPlaying = false;

async function scheduleEditorPlayback() {
    if (editorPlaying) stopEditorPlayback();
    editorPlaying = true;

    if (audioCtx.state === "suspended") await audioCtx.resume();

    // Collect MML from inputs
    const mmlTracks = editorInputs.map(t => t.value.trim());
    if (mmlTracks.every(track => !track)) {
        alert("Enter some MML first!");
        return;
    }

    // Preload instruments (re-use user selections)
    editorInstruments.melody = await preloadInstrument(melodyInstSelect.value);
    editorInstruments.harmony1 = await preloadInstrument(harmony1InstSelect.value);
    editorInstruments.harmony2 = await preloadInstrument(harmony2InstSelect.value);

    const tracks = [
        {data: mmlTracks[0], inst: editorInstruments.melody},
        {data: mmlTracks[1], inst: editorInstruments.harmony1},
        {data: mmlTracks[2], inst: editorInstruments.harmony2}
    ].filter(t => t.data);

    editorScheduledNotes = [];

    // Determine tempo
    let globalTempo = 120;
    for (const track of tracks) {
        const {tempo} = parseMML(track.data);
        if (tempo) {
            globalTempo = tempo;
            break;
        }
    }

    // Create per-track gain & compressor
    const trackScale = 0.9 / tracks.length;
    tracks.forEach(track => {
        track.trackGain = audioCtx.createGain();
        track.trackGain.gain.value = trackScale;

        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-12, audioCtx.currentTime);
        comp.knee.setValueAtTime(24, audioCtx.currentTime);
        comp.ratio.setValueAtTime(2, audioCtx.currentTime);
        comp.attack.setValueAtTime(0.01, audioCtx.currentTime);
        comp.release.setValueAtTime(0.25, audioCtx.currentTime);

        track.trackGain.connect(comp);
        comp.connect(masterGain);
    });

    const startTime = audioCtx.currentTime;
    const beatSec = 60 / globalTempo;

    // Schedule notes
    tracks.forEach(track => {
        const {notes} = parseMML(track.data);
        let timeSec = startTime;

        for (const n of notes) {
            const durSec = n.duration * beatSec;
            if (n.note) {
                const noteGain = audioCtx.createGain();
                noteGain.gain.value = (n.volume || 15) / 15;
                noteGain.connect(track.trackGain);

                const node = track.inst.play(n.note, timeSec, {
                    duration: durSec,
                    destination: noteGain
                });

                editorScheduledNotes.push({node, noteGain});

                // Cleanup
                setTimeout(() => {
                    try {
                        noteGain.disconnect();
                    } catch {
                    }
                }, (durSec + 0.3) * 1000);
            }

            timeSec += durSec;
        }
    });

    console.log(`Editor preview started @ ${globalTempo} BPM`);
}

function stopEditorPlayback() {
    if (!editorPlaying) return;
    editorPlaying = false;
    editorScheduledNotes.forEach(n => {
        try {
            n.node.stop();
        } catch {
        }
        if (n.noteGain) n.noteGain.disconnect();
    });
    editorScheduledNotes = [];
    console.log("Editor preview stopped");
}

function clearEditorFields() {
    editorInputs.forEach(t => (t.value = ""));
    console.log("Editor fields cleared");
}

// --- Bind Editor Buttons ---
previewBtn.addEventListener("click", scheduleEditorPlayback);
stopEditorBtn.addEventListener("click", stopEditorPlayback);
clearEditorBtn.addEventListener("click", clearEditorFields);


// addEventListener('click', () => openChar(character));
// --- Dialog box for Guide/Legend section ---
const legendBtn = document.getElementById("legend");
legendBtn.addEventListener("click", openLegendDialog);

function openLegendDialog() {
    const dialog = document.getElementById('mmlLegendDialog');

    // Fixed: Use backticks for template literals
    dialog.innerHTML = `
            <button class="close-dialog">✕</button>
            <div class="reference-grid">
        <div>
            <h4>Tips for beginners</h4>
            <p>Use one track first (melody only).<br>Play with tempo and octave. You’ll get a feel for how
                music “moves”.<br>Try repeating patterns. & remember to experiment.<br> You can’t “break”
                anything — just adjust letters and numbers.
            </p>
            <p>One small thing to be aware about, is that tempo has to be set in track 1 - the melody<br>
                A standard template before your notes could look like this "t120 o4 l4 v12"</p>
        </div>

        <div>
            <h4>Notes</h4>
            <p>C D E F G A B<br>Use + or # for sharps, - for flats (e.g. C+, D-)</p>
        </div>
        <div>
            <h4>Length</h4>
            <p>l4 = quarter note<br>l8 = eighth note<br>Use "." to extend (e.g. l8.)</p>
        </div>
        <div>
            <h4>Volume / Tempo</h4>
            <p> v0 = no volume<br>v8 = medium volume<br>v15 = max volume<br>t120 = tempo 120 BPM</p>
        </div>
        <div>
            <h4>Octave / Tie</h4>
            <p> o3 = lower pitch<br>o4 = middle pitch <br>o5 = higher pitch<br> & = tie notes<br>&gt; / &lt; = octave up/down</p>
        </div>
    </div>
        `;

    dialog.showModal();

    // Fixed: selector and close() function call
    const closeBtn = dialog.querySelector('.close-dialog');
    closeBtn.onclick = () => dialog.close();
}


// --- EXPERIMENTAL SECTION END ---


// --- Initialize Page ---
async function renderPage() {
    await loadInstruments();
    await loadSongs();

    playBtn.disabled = false;
    stopBtn.disabled = false;
}

// --- Start App ---
await renderPage();
