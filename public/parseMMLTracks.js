// --- parseMMLTracks ---
// Accepts an object with multiple MML tracks (e.g., { melody: "...", harmony1: "...", harmony2: "..." })
// Returns: { tracks: [{ name, events }], totalDuration, tempoHistory }
function parseMMLTracks(trackMap, opts = {}) {
    const defaultTempo = opts.tempo || 120;
    const defaultLength = opts.defaultLen || 4;

    const tracks = [];
    let globalTempoHistory = [];

    const parseSingleTrack = (name, mml) => {
        if (!mml || typeof mml !== 'string') return { name, events: [], totalDuration: 0, tempoHistory: [] };

        const tokenRegex = /(t\d+|v\d+|l\d+|o\d+|[<>]|&|r\d*\.?|[a-gA-G][\+#-]?\d*\.?)/g;
        const tokens = mml.match(tokenRegex) || [];

        let octave = 4, tempo = defaultTempo, defaultLenLocal = defaultLength, vol = 15, timeSec = 0;
        const tempoHistory = [{ tempo, atTime: 0 }];
        const events = [];

        const beatsFromLength = (lenDen, dotted) => (4 / lenDen) * (dotted ? 1.5 : 1);
        const secondsFromBeats = (beats, bpm) => beats * (60 / bpm);

        const parseNoteToken = tok => {
            const m = tok.match(/^([a-gA-G])([\+#-]?)(\d+)?(\.)?$/);
            if (!m) return null;
            return {
                letter: m[1].toUpperCase(),
                accidental: m[2],
                len: m[3] ? parseInt(m[3], 10) : defaultLenLocal,
                dotted: !!m[4]
            };
        };

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            if (token.startsWith('t')) {
                tempo = parseInt(token.slice(1), 10) || tempo;
                tempoHistory.push({ tempo, atTime: timeSec });
                continue;
            }
            if (token.startsWith('l')) { defaultLenLocal = parseInt(token.slice(1), 10) || defaultLenLocal; continue; }
            if (token.startsWith('v')) { vol = parseInt(token.slice(1), 10) || vol; continue; }
            if (token.startsWith('o')) { octave = Math.min(Math.max(parseInt(token.slice(1), 10), 0), 9); continue; }
            if (token === '>') { octave = Math.min(9, octave + 1); continue; }
            if (token === '<') { octave = Math.max(0, octave - 1); continue; }

            if (token.startsWith('r')) {
                const m = token.match(/^r(\d+)?(\.)?$/);
                const lenDen = m && m[1] ? parseInt(m[1], 10) : defaultLenLocal;
                const dotted = !!(m && m[2]);
                timeSec += secondsFromBeats(beatsFromLength(lenDen, dotted), tempo);
                continue;
            }

            const parsed = parseNoteToken(token);
            if (parsed) {
                let totalBeats = beatsFromLength(parsed.len, parsed.dotted);
                // Handle ties &
                let look = i + 1;
                while (look < tokens.length && tokens[look] === '&' && (look + 1) < tokens.length) {
                    const nextParsed = parseNoteToken(tokens[look + 1]);
                    if (!nextParsed || nextParsed.letter !== parsed.letter || (nextParsed.accidental || '') !== (parsed.accidental || '')) break;
                    totalBeats += beatsFromLength(nextParsed.len, nextParsed.dotted);
                    look += 2;
                }
                i = look - 1;

                const durationSec = secondsFromBeats(totalBeats, tempo);
                events.push({
                    note: normalizeNoteString(parsed.letter, parsed.accidental, octave),
                    start: timeSec,
                    duration: durationSec,
                    volume: vol
                });

                timeSec += durationSec;
            }
        }

        return { name, events, totalDuration: timeSec, tempoHistory };
    };

    // Parse each track
    for (const [trackName, mml] of Object.entries(trackMap)) {
        const trackData = parseSingleTrack(trackName, mml);
        tracks.push(trackData);
        globalTempoHistory.push(...trackData.tempoHistory);
    }

    return {
        tracks,
        totalDuration: Math.max(...tracks.map(t => t.totalDuration)),
        tempoHistory: globalTempoHistory
    };
}

// Export for browser usage
window.parseMMLTracks = parseMMLTracks;
