// === mml-player.js ===
// Browser, Soundfont-player v0.12.0
// Exports: parseMMLTracks, schedulePlaybackFromTracks, noteNameToMidi

// --- Utility functions ---
function normalizeNoteString(letter, accidental, octave) {
    let acc = accidental || '';
    if (acc === '+') acc = '#';
    if (acc === '-') acc = 'b';
    let oct = Number.isFinite(+octave) ? +octave : 4;
    oct = Math.min(Math.max(oct, 0), 9);
    return `${letter.toUpperCase()}${acc}${oct}`;
}

function noteNameToMidi(noteName) {
    if (!noteName) return null;
    const m = noteName.match(/^([A-Ga-g])([#b]?)(\d+)$/);
    if (!m) return null;
    const letter = m[1].toUpperCase();
    const acc = m[2];
    const octave = parseInt(m[3], 10);
    const semitoneMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const base = semitoneMap[letter];
    const accidental = acc === '#' ? 1 : (acc === 'b' ? -1 : 0);
    return (octave + 1) * 12 + base + accidental;
}

// --- Parse single MML string into events ---
function parseMMLToEvents(mml, opts = {}) {
    const defaultTempo = opts.tempo || 120;
    const defaultLen = opts.defaultLen || 4;
    const events = [];
    if (!mml || typeof mml !== 'string') return { events, totalDuration: 0, tempoHistory: [] };

    const tokenRegex = /(t\d+|v\d+|l\d+|o\d+|[<>]|&|r\d*\.?|[a-gA-G][\+#-]?\d*\.?)/g;
    const tokens = mml.match(tokenRegex) || [];

    let octave = 4, tempo = defaultTempo, defaultLength = defaultLen, currentVol = 15;
    let beatPosition = 0;  // Track position in beats
    const tempoHistory = [{ tempo, atBeat: 0 }];

    const beatsFromLength = (lenDen, dotted) => {
        const beats = 4 / lenDen;
        return dotted ? beats * 1.5 : beats;
    };

    const parseNoteToken = tok => {
        const m = tok.match(/^([a-gA-G])([\+#-]?)(\d+)?(\.)?$/);
        if (!m) return null;
        return { letter: m[1].toUpperCase(), accidental: m[2], len: m[3] ? parseInt(m[3], 10) : defaultLength, dotted: !!m[4] };
    };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.startsWith('t')) {
            tempo = parseInt(token.slice(1), 10) || tempo;
            tempoHistory.push({ tempo, atBeat: beatPosition });
            continue;
        }
        if (token.startsWith('l')) { defaultLength = parseInt(token.slice(1), 10) || defaultLength; continue; }
        if (token.startsWith('v')) { currentVol = parseInt(token.slice(1), 10) || currentVol; continue; }
        if (token.startsWith('o')) { octave = Math.min(Math.max(parseInt(token.slice(1), 10), 0), 9); continue; }
        if (token === '>') { octave = Math.min(9, octave + 1); continue; }
        if (token === '<') { octave = Math.max(0, octave - 1); continue; }

        if (token.startsWith('r')) {
            const m = token.match(/^r(\d+)?(\.)?$/);
            const lenDen = m && m[1] ? parseInt(m[1], 10) : defaultLength;
            const dotted = !!(m && m[2]);
            const restBeats = beatsFromLength(lenDen, dotted);
            beatPosition += restBeats;  // Advance time but don't create event
            continue;
        }

        const parsed = parseNoteToken(token);
        if (parsed) {
            let totalBeats = beatsFromLength(parsed.len, parsed.dotted);
            let look = i + 1;
            while (look < tokens.length && tokens[look] === '&' && (look + 1) < tokens.length) {
                const nextParsed = parseNoteToken(tokens[look + 1]);
                if (!nextParsed || nextParsed.letter.toUpperCase() !== parsed.letter.toUpperCase() || (nextParsed.accidental || '') !== (parsed.accidental || '')) break;
                totalBeats += beatsFromLength(nextParsed.len, nextParsed.dotted);
                look += 2;
            }
            i = look - 1;

            // Store event with its beat position
            events.push({
                note: normalizeNoteString(parsed.letter, parsed.accidental, octave),
                startBeat: beatPosition,
                durationBeats: totalBeats,
                volume: currentVol
            });

            beatPosition += totalBeats;
        }
    }

    return { events, tempoHistory, totalBeats: beatPosition };
}

// --- Parse multiple tracks, align events globally ---
function parseMMLTracks(tracksMML, opts = {}) {
    const trackData = tracksMML.map(mml => parseMMLToEvents(mml, opts));

    // Build global tempo timeline (in beats)
    const tempoTimeline = [];
    trackData.forEach(track => {
        track.tempoHistory.forEach(h => {
            tempoTimeline.push({ tempo: h.tempo, atBeat: h.atBeat });
        });
    });
    tempoTimeline.sort((a, b) => a.atBeat - b.atBeat);

    // Remove duplicate tempo changes at same beat
    const uniqueTempoTimeline = [];
    for (let i = 0; i < tempoTimeline.length; i++) {
        if (i === 0 || tempoTimeline[i].atBeat !== tempoTimeline[i-1].atBeat) {
            uniqueTempoTimeline.push(tempoTimeline[i]);
        }
    }

    // Convert beats to seconds using global tempo timeline
    function beatsToSeconds(beatPos) {
        let time = 0;
        let currentBeat = 0;
        let currentTempo = uniqueTempoTimeline[0]?.tempo || opts.tempo || 120;

        for (let i = 0; i < uniqueTempoTimeline.length; i++) {
            const tempoChange = uniqueTempoTimeline[i];

            if (beatPos <= tempoChange.atBeat) {
                // Target is before this tempo change
                const beatsToGo = beatPos - currentBeat;
                time += (beatsToGo * 60) / currentTempo;
                return time;
            }

            // Add time up to this tempo change
            const beatsDelta = tempoChange.atBeat - currentBeat;
            time += (beatsDelta * 60) / currentTempo;
            currentBeat = tempoChange.atBeat;
            currentTempo = tempoChange.tempo;
        }

        // After last tempo change
        const beatsToGo = beatPos - currentBeat;
        time += (beatsToGo * 60) / currentTempo;
        return time;
    }

    // Convert all events to absolute times
    const globalEvents = trackData.map(track => {
        return track.events.map(ev => ({
            note: ev.note,
            start: beatsToSeconds(ev.startBeat),
            duration: beatsToSeconds(ev.startBeat + ev.durationBeats) - beatsToSeconds(ev.startBeat),
            volume: ev.volume
        }));
    });

    const totalDuration = Math.max(...globalEvents.map(track =>
        track.reduce((max, ev) => Math.max(max, ev.start + ev.duration), 0)
    ), 0);

    return { globalEvents, totalDuration };
}

// --- Schedule playback from tracks ---
async function schedulePlaybackFromTracks(trackConfigs, opts = {}) {
    const audioCtx = opts.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const masterGain = opts.masterGain || audioCtx.createGain();
    masterGain.gain.value = opts.masterVolume != null ? opts.masterVolume : 0.5;
    masterGain.connect(audioCtx.destination);

    const lookaheadMs = Number.isFinite(opts.lookaheadMs) ? opts.lookaheadMs : 500;
    const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : 100;

    let playing = true;
    const scheduled = new Map();
    const intervals = [];
    const eventId = (t, idx) => `${t}:${idx}`;

    // Load instruments
    for (let t = 0; t < trackConfigs.length; t++) {
        const cfg = trackConfigs[t];
        if (!cfg.inst) {
            try { cfg.inst = await Soundfont.instrument(audioCtx, cfg.instrumentName || 'acoustic_grand_piano', { gain: 1, destination: cfg.trackGain || masterGain }); }
            catch (err) { console.error('Instrument load failed', cfg.instrumentName, err); cfg.inst = null; }
        }
        cfg.events = cfg.events || [];
    }

    const startTime = audioCtx.currentTime + 0.05;

    function scheduleTick() {
        const now = audioCtx.currentTime;
        const windowEnd = now + lookaheadMs / 1000;
        trackConfigs.forEach((cfg, tIndex) => {
            if (!cfg.inst) return;
            for (let i = 0; i < cfg.events.length; i++) {
                const ev = cfg.events[i];
                const evAbsolute = startTime + ev.start;
                const id = eventId(tIndex, i);
                if (scheduled.has(id)) continue;
                if (evAbsolute >= now - 0.01 && evAbsolute <= windowEnd) {
                    const noteGain = audioCtx.createGain();
                    noteGain.gain.value = (ev.volume || 15) / 15;
                    noteGain.connect(cfg.trackGain || masterGain);
                    try {
                        const node = cfg.inst.play(ev.note, evAbsolute, { duration: ev.duration, destination: noteGain });
                        scheduled.set(id, { node, noteGain });
                        setTimeout(() => { const s = scheduled.get(id); if (s) { try { s.noteGain.disconnect(); } catch{} scheduled.delete(id); } }, (ev.duration + 0.5) * 1000);
                    } catch (err) {
                        console.error('Error scheduling note', ev.note, 'at', evAbsolute, err);
                        scheduled.set(id, { node: null, noteGain: null });
                    }
                }
            }
        });
    }

    intervals.push(setInterval(() => { if (playing) scheduleTick(); }, intervalMs));
    scheduleTick();

    return {
        stop() {
            playing = false;
            intervals.forEach(id => clearInterval(id));
            scheduled.forEach(v => { try { v.node?.stop(); } catch {} try { v.noteGain?.disconnect(); } catch {} });
            scheduled.clear();
        },
        info() { return { startTime, totalEvents: trackConfigs.reduce((acc, cfg) => acc + cfg.events.length, 0) }; }
    };
}

// --- ES module exports ---
export { parseMMLTracks, schedulePlaybackFromTracks, noteNameToMidi };