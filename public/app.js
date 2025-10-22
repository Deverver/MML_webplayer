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
    "acoustic_grand_piano","bright_acoustic_piano","electric_piano_1",
    "electric_piano_2","harpsichord","acoustic_guitar_nylon",
    "acoustic_guitar_steel","electric_guitar_clean","overdriven_guitar",
    "distortion_guitar","violin","cello","string_ensemble_1",
    "choir_aahs","flute","trumpet","trombone","clarinet",
    "french_horn","sax_alto","banjo","harmonica","sitar"
];

// --- Populate instrument selects ---
function populateInstrumentSelect(select){
    select.innerHTML = "";
    GM_INSTRUMENTS.forEach(name=>{
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name.replace(/_/g," ");
        select.appendChild(opt);
    });
    select.value="acoustic_grand_piano";
}

// --- MML Parsing ---
function parseMML(mml){
    let octave=4, tempo=120, defaultLen=4, currentVol=15;
    const notes=[];
    const tokens = mml.match(/(t\d+|v\d+|l\d+|[<>]|r\d*|[a-gA-G]#?\d*)/g)||[];
    for(const token of tokens){
        if(token.startsWith("t")) tempo=parseInt(token.slice(1));
        else if(token.startsWith("l")) defaultLen=parseInt(token.slice(1))||defaultLen;
        else if(token.startsWith("v")) currentVol = parseInt(token.slice(1));
        else if(token==">") octave++;
        else if(token=="<") octave--;
        else if(token.startsWith("r")){
            const len=parseInt(token.slice(1))||defaultLen;
            notes.push({note:null,duration:len,volume:currentVol});
        } else if(/[a-gA-G]/.test(token[0])){
            const m=token.match(/([a-gA-G]#?)(\d+)?/);
            const pitch=m[1].toUpperCase();
            const len=m[2]?parseInt(m[2]):defaultLen;
            notes.push({note:`${pitch}${octave}`,duration:len,volume:currentVol});
        }
    }
    return {notes, tempo};
}

function noteLengthToSeconds(length, tempo){
    return (4/length)*(60/tempo);
}

// --- Load Songs ---
async function loadSongs(){
    try{
        const res = await fetch("/songs");
        const {melodyOnly, melodyPlusHarmony, fullSongs} = await res.json();
        function populateSelect(select,songs){
            select.innerHTML = '<option value="">-- Select --</option>';
            songs.forEach(song=>{
                const option = document.createElement("option");
                option.value = JSON.stringify(song);
                option.textContent = song.title;
                select.appendChild(option);
            });
        }
        populateSelect(melodyOnlySelect, melodyOnly);
        populateSelect(melodyPlusSelect, melodyPlusHarmony);
        populateSelect(fullSongsSelect, fullSongs);
        console.log("✅ Songs loaded successfully.");
    }catch(err){
        console.error("❌ Failed to load songs:", err);
    }
}

// --- Preload Instrument ---
async function preloadInstrument(name){
    return await Soundfont.instrument(audioCtx, name, {gain:1});
}

// --- Stop Playback ---
function stopPlayback(){
    if(!playing) return;
    playing=false;
    scheduledNotes.forEach(n=>{
        try{ n.node.stop(); }catch{}
    });
    scheduledNotes=[];
    console.log("⏹️ Playback stopped");
}

// --- Mute / Unmute ---
function muteAllNotes(){
    scheduledNotes.forEach(n=> n.noteGain.gain.setValueAtTime(0, audioCtx.currentTime));
}
function unmuteAllNotes(){
    const sliderGain = volumeSlider.value / 100;
    scheduledNotes.forEach(n=> n.noteGain.gain.setValueAtTime(n.mmlVol*sliderGain, audioCtx.currentTime));
}

// --- Volume Slider ---
volumeSlider.addEventListener("input", ()=>{
    const sliderGain = volumeSlider.value/100;
    if(sliderGain===0) muteAllNotes();
    else unmuteAllNotes();
    masterGain.gain.setValueAtTime(sliderGain, audioCtx.currentTime);
});

// --- Dropdown Change ---
[melodyOnlySelect, melodyPlusSelect, fullSongsSelect].forEach(select=>{
    select.addEventListener("change", ()=>{
        if(!select.value) currentSong=null;
        else currentSong=JSON.parse(select.value);
        [melodyOnlySelect, melodyPlusSelect, fullSongsSelect].forEach(other=>{
            if(other!==select) other.selectedIndex=0;
        });
    });
});

// --- Schedule Playback ---
async function schedulePlayback(){
    if (!currentSong) { alert("Select a song first!"); return; }
    if (playing) stopPlayback();
    playing = true;

    if (audioCtx.state === "suspended") await audioCtx.resume();

    // Preload instruments
    instruments.melody = await preloadInstrument(melodyInstSelect.value);
    instruments.harmony1 = await preloadInstrument(harmony1InstSelect.value);
    instruments.harmony2 = await preloadInstrument(harmony2InstSelect.value);

    // Build active tracks
    const tracks = [
        { data: currentSong.melody, inst: instruments.melody },
        { data: currentSong.harmony1, inst: instruments.harmony1 },
        { data: currentSong.harmony2, inst: instruments.harmony2 }
    ].filter(t => t.data);

    scheduledNotes = [];

    // Per-track gain + optional compressor
    const trackScale = 0.9 / tracks.length; // scale tracks to prevent clipping
    tracks.forEach(track => {
        track.trackGain = audioCtx.createGain();
        track.trackGain.gain.value = trackScale;

        // Mild compressor to prevent occasional loud peaks
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-3, audioCtx.currentTime);
        comp.knee.setValueAtTime(20, audioCtx.currentTime);
        comp.ratio.setValueAtTime(4, audioCtx.currentTime);

        track.trackGain.connect(comp);
        comp.connect(masterGain);
    });

    const startTime = audioCtx.currentTime;

    // Schedule notes
    tracks.forEach(track => {
        const { notes, tempo } = parseMML(track.data);
        let time = startTime;

        notes.forEach(n => {
            const dur = noteLengthToSeconds(n.duration, tempo);

            if (n.note) {
                const noteGain = audioCtx.createGain();
                const volGain = (n.volume !== undefined ? n.volume : 12) / 15; // safe default
                noteGain.gain.value = volGain;
                noteGain.connect(track.trackGain);

                const node = track.inst.play(n.note, time, { gain: 1, destination: noteGain });

                scheduledNotes.push({ node, noteGain, mmlVol: volGain });
            }

            time += dur;
        });
    });

    console.log("▶️ Playback started");
}

// --- Play / Stop Buttons ---
playBtn.addEventListener("click", schedulePlayback);
stopBtn.addEventListener("click", stopPlayback);

async function loadInstruments(){
    populateInstrumentSelect(melodyInstSelect);
    populateInstrumentSelect(harmony1InstSelect);
    populateInstrumentSelect(harmony2InstSelect);
}


// --- Initialize Page ---
async function renderPage(){
    await loadInstruments();
    await loadSongs();

    playBtn.disabled=false;
    stopBtn.disabled=false;
}

// --- Start App ---
renderPage();
