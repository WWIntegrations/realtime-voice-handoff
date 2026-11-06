export function availableActions(s) {
    const active = s.state === 'active_triage' || s.state === 'active_specialist';
    const validOwner = (s.state === 'active_triage' && s.owner === 'triage') || (s.state === 'active_specialist' && s.owner === 'specialist');
    return {
        connect: !s.state || ['idle', 'closed', 'failed'].includes(s.state), play: active && validOwner && !s.played?.[s.owner] && !s.cancelled?.[s.owner], handoff: s.state === 'active_triage', interrupt: active || s.state === 'awaiting_ack', close: active || ['connecting', 'awaiting_ack', 'failed'].includes(s.state), record: active && validOwner && !s.played?.[s.owner] && !s.cancelled?.[s.owner]
    };
}
export function createMotion(reduced = false) {
    let time = 0, last = 0, paused = reduced;
    return {
        get time() {
            return time;
        }, get paused() {
            return paused;
        }, tick(now) {
            if (!paused)
                time += Math.max(0, now - last);
            last = now;
        }, pause(value) {
            paused = reduced || value;
        }, frame(ms) {
            time = reduced ? 0 : Math.max(0, Number(ms) || 0);
        }
    };
}
export function selectEvents(events, filter, limit) {
    return events.filter(e => filter === 'all' || e.type.includes(filter)).slice(-Math.max(1, limit));
}
export function makePayload(text, topic, reference) {
    return {
        reason: 'user_requested', history: text.trim() ? [{
                id: 'typed-1', role: 'user', text: text.trim(), source: 'typed', completion: 'complete'
            }] : [], slots: {
            topic: topic || null, reference: reference.trim() || null
        }
    };
}
// Piecewise interpolation of inspected scroll samples, not recovered site easing.
export function scrollPose(scroll, mobile) {
    const points = mobile ? [[0, 0, 0, 1], [271, -10.042, 154.618, 1.031382], [708, -26.379, 406.160, 1.082436], [1149, -32, 492.7, 1.1]] : [[0, 0, 0, 1], [400, 1.294, 0, 1], [800, 527.257, 0, 1], [1200, 999.788, 0, 1]];
    let a = points[0], b = points.at(-1);
    for (let i = 1; i < points.length; i++) {
        if (scroll <= points[i][0]) {
            a = points[i - 1];
            b = points[i];
            break;
        }
    }
    const t = Math.max(0, Math.min(1, (scroll - a[0]) / (b[0] - a[0])));
    return {
        x: a[1] + (b[1] - a[1]) * t, y: a[2] + (b[2] - a[2]) * t, scale: a[3] + (b[3] - a[3]) * t
    };
}
export function fitTracking(naturalWidth, targetWidth, letters) {
    return letters > 0 ? (targetWidth - naturalWidth) / letters : 0;
}
export async function readBoundedWav(file) {
    if (file.size > 2 * 1024 * 1024)
        throw new Error('wav_too_large: maximum 2 MiB');
    return file.arrayBuffer();
}
export function renderWaveform(ctx, probe, gain) {
    if (!ctx)
        return probe?.fresh ? `Canvas unavailable. Actual mix RMS ${probe.rms.toFixed(4)}.` : 'Canvas unavailable. No fresh PCM samples.';
    ctx.fillStyle = '#030303';
    ctx.fillRect(0, 0, 432, 200);
    ctx.strokeStyle = '#232323';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 100);
    ctx.lineTo(432, 100);
    ctx.stroke();
    if (!probe || !probe.fresh)
        return probe ? 'No fresh PCM samples' : 'Connect to measure output PCM';
    const wave = probe.waveform || [];
    ctx.strokeStyle = '#e2ded5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    wave.forEach((v, i) => {
        const x = i * 432 / Math.max(1, wave.length - 1), y = 100 - Math.max(-1, Math.min(1, v * gain)) * 75;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    return `Actual mix PCM | RMS ${probe.rms.toFixed(4)} | ${gain}x`;
}
export function createOperationRunner({ onStart, onError, onFinish }) {
    let latest = 0;
    return async function run(action) {
        const operation = ++latest;
        const current = () => operation === latest;
        onStart();
        try {
            await action(current);
        }
        catch (error) {
            if (current())
                onError(error);
        }
        finally {
            if (current())
                await onFinish();
        }
    };
}
export async function importSessionWav(file, own, current) {
    const bytes = await readBoundedWav(file);
    if (!current())
        return null;
    return own.importWav(bytes);
}
