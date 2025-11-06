// app.js
import { parseMMLTracks, schedulePlaybackFromTracks } from './mml-player.js';

let currentSong = null;
let audioCtx = null;
let playbackController = null;


// --- DOM Elements ---
const melodyOnlySelect = document.getElementById('melody-only');
const melodyPlusSelect = document.getElementById('melody-plus-harmony');
const fullSongsSelect = document.getElementById('full-songs');

const melodyInstrument = document.getElementById('melody-instrument');
const harmony1Instrument = document.getElementById('harmony1-instrument');
const harmony2Instrument = document.getElementById('harmony2-instrument');

const playBtn = document.getElementById('play-btn');
const stopBtn = document.getElementById('stop-btn');
const volumeSlider = document.getElementById('volume');

const trackSelects = [melodyInstrument, harmony1Instrument, harmony2Instrument];
const songSelects = [melodyOnlySelect, melodyPlusSelect, fullSongsSelect];

// --- Initialize AudioContext after user gesture ---
function initAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

// --- Fetch Songs and populate selects ---
async function loadSongs() {
    const res = await fetch('/songs');
    const data = await res.json();

    function populateSelect(select, songs) {
        select.innerHTML = '<option value="">-- select a song --</option>';
        songs.forEach(song => {
            select.innerHTML += `<option value="${song.index}">${song.title}</option>`;
        });
    }

    populateSelect(melodyOnlySelect, data.melodyOnly);
    populateSelect(melodyPlusSelect, data.melodyPlusHarmony);
    populateSelect(fullSongsSelect, data.fullSongs);
}

// --- Handle mutual exclusive song selection ---
songSelects.forEach(select => {
    select.addEventListener('change', async () => {
        const index = select.value;
        if (!index) {
            currentSong = null;
        } else {
            // Fetch the actual song by index
            const res = await fetch(`/songs/${index}`);
            currentSong = await res.json();
        }
        // Reset other selects
        songSelects.forEach(other => {
            if (other !== select) other.selectedIndex = 0;
        });
    });
});

// --- Populate instrument dropdowns ---
async function loadInstruments() {
    const instruments = [
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

    trackSelects.forEach(select => {
        select.innerHTML = '';
        instruments.forEach((inst, index) => {
            select.innerHTML += `<option value="${inst}">${inst.replace(/_/g, ' ')}</option>`;
        });
    });
}

// --- Stop Playback ---
function stopPlayback() {
    if (playbackController) {
        playbackController.stop();
        playbackController = null;
    }
}

// --- Play Song ---
async function playSong() {
    if (!currentSong) return alert('Please select a song first');

    // Initialize AudioContext
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    // Stop any existing playback
    if (playbackController) {
        playbackController.stop();
        playbackController = null;
    }

    // Build array of MML strings for tracks that exist
    const tracksMML = [];
    const instrumentNames = [];

    const trackInputs = [
        { key: 'melody', instr: melodyInstrument },
        { key: 'harmony1', instr: harmony1Instrument },
        { key: 'harmony2', instr: harmony2Instrument }
    ];

    trackInputs.forEach(({ key, instr }) => {
        if (currentSong[key]) {
            tracksMML.push(currentSong[key]);
            instrumentNames.push(instr.value || 'acoustic_grand_piano');
        }
    });

    if (!tracksMML.length) return alert('No tracks to play');

    // Parse all tracks with global tempo synchronization
    const { globalEvents, totalDuration } = parseMMLTracks(tracksMML, { tempo: 120 });

    console.log('Parsed tracks:', globalEvents.length);
    console.log('Total duration:', totalDuration);
    console.log('Track 0 events:', globalEvents[0]?.length);
    console.log('Track 1 events:', globalEvents[1]?.length);
    console.log('Track 2 events:', globalEvents[2]?.length);

    // Create master gain node
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = volumeSlider.value / 100;
    masterGain.connect(audioCtx.destination);

    // Build track configs with parsed events and instruments
    const trackConfigs = globalEvents.map((events, i) => ({
        events: events,  // Already have start times from parseMMLTracks
        instrumentName: instrumentNames[i]
    }));

    // Schedule playback with synchronized tracks
    playbackController = await schedulePlaybackFromTracks(trackConfigs, {
        audioCtx,
        masterGain,
        masterVolume: volumeSlider.value / 100
    });

    console.log('Playback started:', playbackController.info());
}

// --- Event listeners ---
playBtn.addEventListener('click', playSong);
stopBtn.addEventListener('click', stopPlayback);

volumeSlider.addEventListener('input', () => {
    // Update master gain if playback is active
    if (audioCtx) {
        const masterGain = audioCtx.destination;
        // Try to find the master gain node (this is a simplified approach)
        // In production, you'd want to store a reference to masterGain
        console.log('Volume changed to:', volumeSlider.value);
    }
});

// --- Init ---
(async function init() {
    await loadSongs();
    await loadInstruments();
})();