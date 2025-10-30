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