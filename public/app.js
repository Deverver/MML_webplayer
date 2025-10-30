// app.js
import { parseMMLTracks, schedulePlaybackFromTracks, noteNameToMidi } from './mml-player.js';

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
        'acoustic_grand_piano', 'electric_grand_piano', 'acoustic_guitar_nylon',
        'acoustic_guitar_steel', 'violin', 'cello', 'flute', 'clarinet', 'saxophone'
    ];

    trackSelects.forEach(select => {
        select.innerHTML = '';
        instruments.forEach(inst => {
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

    // Build array of tracks that actually have MML
    const tracks = [];
    const trackInputs = [
        { key: 'melody', instr: melodyInstrument },
        { key: 'harmony1', instr: harmony1Instrument },
        { key: 'harmony2', instr: harmony2Instrument }
    ];

    trackInputs.forEach(({ key, instr }) => {
        if (currentSong[key]) {
            tracks.push({
                mml: currentSong[key] || '',
                instrumentName: instr.value || 'acoustic_grand_piano'
            });
        }
    });

    if (!tracks.length) return alert('No tracks to play');

    // Convert to array of MML strings
    const tracksMML = tracks.map(t => t.mml);

    // Parse all tracks at once
    const { globalEvents } = parseMMLTracks(tracksMML, { tempo: 120 });

    // Determine a common start time for all tracks
    const startTime = audioCtx.currentTime + 0.1; // small offset to avoid scheduling issues

    // Map parsed events to instruments and apply start time offset
    const trackConfigs = globalEvents.map((events, i) => ({
        events: events.map(e => ({ ...e, time: e.time + startTime })),
        instrumentName: tracks[i].instrumentName
    }));

    // Create master gain node
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = volumeSlider.value / 100;
    masterGain.connect(audioCtx.destination);

    // Schedule playback
    playbackController = await schedulePlaybackFromTracks(trackConfigs, {
        audioCtx,
        masterGain
    });
}

// --- Event listeners ---
playBtn.addEventListener('click', playSong);
stopBtn.addEventListener('click', stopPlayback);

volumeSlider.addEventListener('input', () => {
    if (playbackController && playbackController.masterGain) {
        playbackController.masterGain.gain.value = volumeSlider.value / 100;
    }
});

// --- Init ---
(async function init() {
    await loadSongs();
    await loadInstruments();
})();
