import { createVoiceLab } from '../src/runtime.js';
import { availableActions, createMotion, selectEvents, makePayload, scrollPose, fitTracking, renderWaveform, createOperationRunner, importSessionWav } from './controller.mjs';
const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let motion = createMotion(reduced.matches), manualFrame = false, lab = null, unsubscribe = null, generation = 0, busy = false, metrics = null, events = [], state = {
    state: 'idle', owner: null, epoch: 0, playback: 'silent'
}, source = null, mode = 'transport', inspect = null, filter = 'all', live = true, polling = false, lastPoll = 0, lastEvent = 0;
window.voiceLab = null;
let frozenScroll = window.scrollY;
const instrument = $('instrument'), canvas = $('waveform'), ctx = canvas.getContext('2d');
const boot = document.createElement('div');
boot.className = 'boot';
boot.setAttribute('aria-hidden', 'true');
const bootWord = document.createElement('span');
bootWord.textContent = 'WW / LOCAL VOICE';
boot.append(bootWord);
document.body.append(boot);
function notify(message) {
    $('notice').textContent = message;
}
function readable(value) {
    return JSON.stringify(value, null, 2);
}
function updateMeta() {
    window.showcaseMeta = {
        state: state.state, owner: state.owner, epoch: state.epoch, motionPaused: motion.paused, reducedMotion: reduced.matches, live, source: source || 'procedural-tone', introMs: 8000, durationMs: 8000, decorativeMs: motion.time, events: events.length
    };
}
function actions() {
    const a = availableActions(state);
    $('power').disabled = busy || (!a.connect && state.state !== 'idle');
    $('power').classList.toggle('connected', ['active_triage', 'awaiting_ack', 'active_specialist'].includes(state.state));
    $('power').querySelector('.power-label').textContent = state.state === 'connecting' ? 'Connecting' : a.connect ? 'Connect' : 'Connected';
    $('play-tone').disabled = busy || !a.play || state.recording;
    $('interrupt').disabled = !a.interrupt;
    $('handoff').disabled = busy || !a.handoff || state.recording;
    $('close-session').disabled = !a.close;
    $('record-toggle').disabled = busy || (!a.record && !state.recording);
    $('record-toggle').classList.toggle('recording', Boolean(state.recording));
    $('record-toggle').querySelector('span:last-child').textContent = state.recording ? 'Stop recording' : 'Record input';
    $('cancel-recording').disabled = !state.recording;
    $('wav-open').disabled = busy || !a.record || state.recording;
    $('source-tone').disabled = busy || !a.record || state.recording;
    $('owner-label').textContent = state.owner || 'No owner';
    $('state-label').textContent = state.state.replaceAll('_', ' ');
    $('play-tone').title = a.play ? 'Play selected source once for current owner' : 'One play per role. Close and connect for a new session.';
    updateMeta();
}
function selectView(view, detail = null) {
    mode = view;
    inspect = detail;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === mode)));
    renderScreen();
}
function selectedEvent() {
    return events[Number($('event-index').value)] || null;
}
function screenDetail() {
    const p = metrics?.probes || {}, t = metrics?.transport || {};
    const details = {
        session: state.session_id || 'No session', identity: {
            owner: state.owner, turn_id: state.turn_id
        }, epoch: {
            epoch: state.epoch, cancelled: state.cancelled
        }, pair: {
            T: t.T?.selectedPair ?? null, S: t.S?.selectedPair ?? null
        }, inbound: {
            T: t.T?.inbound ?? null, S: t.S?.inbound ?? null
        }, errors: state.lastError || 'No runtime error', audio: {
            selected: source || 'procedural-tone', played: state.played
        }, snapshot: state.receivedSnapshot || state.pending || 'No snapshot', triage: p.triage ? {
            rms: p.triage.rms, fresh: p.triage.fresh
        } : 'No PCM', specialist: p.specialist ? {
            rms: p.specialist.rms, fresh: p.specialist.fresh
        } : 'No PCM', mix: p.mix ? {
            rms: p.mix.rms, fresh: p.mix.fresh
        } : 'No PCM', sampleRate: metrics?.sampleRate ?? 'Not connected', volume: metrics?.masterVolume ?? Number($('volume').value) / 100, window: {
            events: Number($('window-size').value)
        }
    };
    return details[inspect];
}
function renderScreen() {
    canvas.hidden = mode !== 'pcm';
    $('screen-text').hidden = mode === 'pcm';
    $('screen-caption').textContent = '';
    if (mode === 'pcm') {
        drawWave();
        return;
    }
    let text;
    if (inspect)
        text = inspect.toUpperCase() + '\n' + readable(screenDetail());
    else if (mode === 'snapshot') {
        const snap = state.receivedSnapshot || state.pending;
        text = snap ? 'SNAPSHOT / REAL STATE\n' + readable(snap) : 'SNAPSHOT\nNo message received.\n\nHandoff sends typed context.';
    }
    else if (mode === 'events') {
        const e = selectedEvent();
        text = e ? `EVENT ${e.sequence}\n${e.type}\n${e.state?.state || e.state}\nepoch ${e.state?.epoch ?? e.epoch ?? 'n/a'}` : 'EVENT LOG\nNo events yet.';
    }
    else {
        text = `VOICE HANDOFF v1\n${state.state.toUpperCase()}\n\nOwner: ${state.owner || 'none'}\n${state.session_id ? 'Epoch ' + state.epoch + ' / ' + state.playback : 'Press Connect.'}`;
    }
    $('screen-text').textContent = text;
}
function drawWave() {
    const caption = renderWaveform(ctx, metrics?.probes?.mix, Number($('view-scale').value));
    if (!ctx) {
        canvas.hidden = true;
        $('screen-text').hidden = false;
        $('screen-text').textContent = caption;
        $('screen-caption').textContent = 'Audio and transport remain independent.';
        return;
    }
    $('screen-caption').textContent = caption;
}
function renderEvidence() {
    $('snapshot-output').textContent = state.receivedSnapshot ? readable(state.receivedSnapshot) : 'No snapshot received.';
    const list = selectEvents(events, filter, Number($('window-size').value));
    $('event-list').replaceChildren();
    for (const e of list) {
        const li = document.createElement('li');
        li.dataset.sequence = e.sequence;
        li.dataset.type = e.type;
        li.textContent = `${e.sequence} / ${e.type} / ${e.state?.state || e.state} / epoch ${e.state?.epoch ?? e.epoch ?? 'n/a'}`;
        li.classList.toggle('selected', e.sequence === selectedEvent()?.sequence);
        $('event-list').append(li);
    }
    $('event-empty').hidden = list.length > 0;
    $('event-empty').textContent = events.length ? 'No events match this filter.' : 'No events yet.';
    $('metrics-output').textContent = metrics ? readable({
        session: state.session_id, state: state.state, owner: state.owner, epoch: state.epoch, source: source || 'procedural-tone', sampleRate: metrics.sampleRate, masterVolume: metrics.masterVolume, transport: metrics.transport, probes: Object.fromEntries(Object.entries(metrics.probes).map(([k, v]) => [k, {
                rms: v.rms, fresh: v.fresh, windows: v.windows.length, lastEndTime: v.lastEndTime
            }]))
    }) : 'Connect to collect RTP and PCM measurements.';
}
function acceptEvents(next) {
    if (!next)
        return;
    events = next;
    if (events.at(-1)?.sequence !== lastEvent) {
        lastEvent = events.at(-1)?.sequence || 0;
        $('event-index').max = Math.max(0, events.length - 1);
        $('event-index').value = Math.max(0, events.length - 1);
        updateKnob($('event-index'));
        const e = events.at(-1);
        $('trace-ribbon').textContent = e ? `${e.sequence} / ${e.type} / ${e.state?.state || e.state}` : 'No events.';
    }
}
async function poll() {
    if (!lab || polling)
        return;
    const own = lab, stamp = generation;
    polling = true;
    try {
        const next = await own.getMetrics();
        if (stamp !== generation || own !== lab)
            return;
        metrics = next;
        state = own.getState();
        acceptEvents(metrics.events);
        actions();
        if (live) {
            renderScreen();
            renderEvidence();
        }
    }
    catch (error) {
        if (stamp === generation)
            notify('Metrics unavailable: ' + error.message);
    }
    finally {
        polling = false;
    }
}
const run = createOperationRunner({
    onStart() {
        busy = true;
        actions();
    },
    onError(error) {
        notify('Action stopped: ' + error.message);
    },
    async onFinish() {
        if (lab)
            state = lab.getState();
        busy = false;
        actions();
        renderScreen();
        await poll();
    }
});
$('power').addEventListener('click', () => run(async (current) => {
    const previous = lab;
    const stamp = ++generation;
    unsubscribe?.();
    if (previous)
        await previous.close();
    if (!current() || stamp !== generation)
        return;
    metrics = null;
    events = [];
    source = null;
    lastEvent = 0;
    const own = createVoiceLab();
    lab = own;
    window.voiceLab = own;
    unsubscribe = own.subscribe(e => {
        if (own !== lab || stamp !== generation)
            return;
        state = e.state;
        if (e.type === 'recording_stopped' && e.audioId)
            source = e.audioId;
        actions();
        if (live)
            renderScreen();
        if (e.type === 'ack_accepted')
            notify('Acknowledgement accepted. Specialist owns the next play.');
    });
    state = own.getState();
    own.setVolume(Number($('volume').value) / 100);
    actions();
    await own.connect();
    if (!current() || own !== lab || stamp !== generation)
        return;
    notify('Connected locally. Choose a source, then Play.');
}));
$('play-tone').addEventListener('click', () => run(() => {
    lab.play(source || (state.owner === 'specialist' ? 'specialist-tone' : 'triage-tone'));
    notify('Playing actual audio for ' + state.owner + '.');
    selectView('pcm');
}));
$('interrupt').addEventListener('click', () => run(() => {
    lab.interrupt('manual');
    notify('Interrupted. This role cannot play again in this session.');
}));
$('handoff').addEventListener('click', () => run(async (current) => {
    const own = lab, stamp = generation;
    source = null;
    selectView('snapshot');
    await own.requestHandoff(makePayload($('history-text').value, $('topic').value, $('reference').value));
    if (!current() || own !== lab || stamp !== generation)
        return;
    if (own.getState().state === 'awaiting_ack')
        notify('Snapshot sent. Waiting for a matching acknowledgement.');
}));
$('close-session').addEventListener('click', () => run(async (current) => {
    const own = lab, stamp = ++generation;
    unsubscribe?.();
    await own.close();
    if (!current() || own !== lab || stamp !== generation)
        return;
    state = own.getState();
    source = null;
    notify('Session closed. Connect starts a new session.');
}));
$('record-toggle').addEventListener('click', () => run(async (current) => {
    const own = lab, stamp = generation;
    const valid = () => current() && own === lab && stamp === generation;
    if (state.recording) {
        const audioId = await own.stopRecording();
        if (!valid())
            return;
        source = audioId;
        notify(source ? 'Recorded audio selected. Press Play.' : 'No audio recorded.');
    }
    else {
        await own.startRecording();
        if (!valid())
            return;
        notify('Recording locally, up to 10 seconds. Press Stop recording.');
    }
}));
$('cancel-recording').addEventListener('click', () => run(() => {
    lab.cancelRecording();
    notify('Recording cancelled.');
}));
$('wav-open').addEventListener('click', () => $('wav-input').click());
$('wav-input').addEventListener('change', () => run(async (current) => {
    const file = $('wav-input').files[0];
    if (!file)
        return;
    const own = lab, stamp = generation;
    const valid = () => current() && own === lab && stamp === generation;
    const audioId = await importSessionWav(file, own, valid);
    if (!valid())
        return;
    source = audioId;
    notify('Local WAV selected: ' + file.name);
    $('wav-input').value = '';
}));
$('source-tone').addEventListener('click', () => {
    source = null;
    notify('Procedural calibration tone selected.');
    selectView('transport', 'audio');
});
$('history-open').addEventListener('click', () => $('context-dialog').showModal());
$('contract-open').addEventListener('click', () => {
    $('architecture').open = true;
    $('architecture').scrollIntoView({
        block: 'start', behavior: 'instant'
    });
});
$('fullscreen').addEventListener('click', () => run(async () => {
    if (document.fullscreenElement)
        await document.exitFullscreen();
    else if (instrument.requestFullscreen)
        await instrument.requestFullscreen();
    else
        notify('Fullscreen is unavailable in this browser.');
}));
$('download-trace').addEventListener('click', () => {
    const blob = new Blob([readable({
            state, metrics, events
        })], {
        type: 'application/json'
    }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = 'local-voice-trace.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('monitor-toggle').addEventListener('click', () => {
    live = !live;
    $('monitor-toggle').setAttribute('aria-pressed', String(live));
    $('monitor-toggle').querySelector('span:last-child').textContent = live ? 'Live view' : 'View held';
    if (live) {
        renderScreen();
        renderEvidence();
    }
    notify(live ? 'Live measurements visible.' : 'Measurement display held. Audio continues until Interrupt.');
    updateMeta();
});
function updateKnob(input) {
    const range = Number(input.max) - Number(input.min), ratio = range ? (Number(input.value) - Number(input.min)) / range : 0;
    input.closest('.knob').style.setProperty('--angle', (-135 + ratio * 270) + 'deg');
    input.closest('.knob').querySelector('output').textContent = input.id === 'volume' ? input.value + '%' : input.id === 'view-scale' ? input.value + 'x' : input.id === 'event-index' ? (selectedEvent()?.sequence || 'None') : input.value;
}
for (const input of document.querySelectorAll('.knob input')) {
    updateKnob(input);
    input.addEventListener('input', () => {
        updateKnob(input);
        if (input.id === 'volume' && lab) {
            try {
                lab.setVolume(Number(input.value) / 100);
            }
            catch (e) {
                notify(e.message);
            }
        }
        if (input.id === 'event-index')
            selectView('events');
        renderScreen();
        renderEvidence();
    });
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => selectView(b.dataset.view)));
document.querySelectorAll('[data-inspect]').forEach(b => b.addEventListener('click', () => selectView('transport', b.dataset.inspect)));
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    selectView('events');
    renderEvidence();
    notify('Event filter: ' + filter + '.');
}));
function drawDecor() {
    if (!motion.paused && !manualFrame)
        frozenScroll = window.scrollY;
    const pose = reduced.matches ? {
        x: 0, y: 0, scale: 1
    } : scrollPose(manualFrame ? 0 : frozenScroll, innerWidth <= 900);
    const t = reduced.matches ? 8000 : motion.time, progress = Math.max(0, Math.min(1, (t - 4500) / 3500));
    boot.hidden = t >= 4500;
    boot.style.setProperty('--phase', String(Math.floor(t / 500) % 8));
    boot.classList.toggle('bars', t > 800);
    instrument.style.opacity = String(progress);
    instrument.style.transform = `translate(${pose.x}px,${pose.y + (1 - progress) * 160}px) scale(${pose.scale})`;
    instrument.style.visibility = frozenScroll > 1500 ? 'hidden' : 'visible';
    $('hero-title').style.opacity = String(progress);
    if (reduced.matches) {
        instrument.style.opacity = '1';
        instrument.style.transform = 'none';
        $('hero-title').style.opacity = '1';
        boot.hidden = true;
        instrument.style.visibility = 'visible';
    }
    updateMeta();
}
$('motion-toggle').addEventListener('click', () => {
    motion.pause(!motion.paused);
    $('motion-toggle').setAttribute('aria-pressed', String(motion.paused));
    $('motion-toggle').setAttribute('aria-label', motion.paused ? 'Resume decorative motion' : 'Pause decorative motion');
    updateMeta();
});
reduced.addEventListener('change', () => {
    motion = createMotion(reduced.matches);
    manualFrame = false;
    $('motion-toggle').disabled = reduced.matches;
    drawDecor();
});
window.showcaseFrame = ms => {
    manualFrame = true;
    motion.frame(ms);
    drawDecor();
    return window.showcaseMeta;
};
function fitHeadline() {
    document.documentElement.style.setProperty('--scale', String(innerWidth > 900 ? Math.min(1, (innerWidth - 32) / 1080) : 1));
    const line = $('hero-title').lastElementChild;
    if (innerWidth <= 900) {
        line.style.letterSpacing = '';
        return;
    }
    line.style.letterSpacing = '0px';
    const range = document.createRange();
    range.selectNodeContents(line);
    const natural = range.getBoundingClientRect().width, target = innerWidth * (1390 / 1440);
    line.style.letterSpacing = fitTracking(natural, target, line.textContent.length) + 'px';
}
window.addEventListener('resize', fitHeadline);
window.showcaseReady = document.fonts.ready.then(() => {
    fitHeadline();
});
window.addEventListener('pagehide', () => {
    void lab?.close();
});
$('instrument').addEventListener('focusin', () => {
    if (motion.time < 8000) {
        motion.frame(8000);
        drawDecor();
    }
});
$('motion-toggle').disabled = reduced.matches;
$('motion-toggle').setAttribute('aria-pressed', String(reduced.matches));
function tick(now) {
    if (!manualFrame) {
        motion.tick(now);
        drawDecor();
    }
    if (now - lastPoll > 120) {
        lastPoll = now;
        void poll();
    }
    requestAnimationFrame(tick);
}
actions();
renderScreen();
requestAnimationFrame(tick);
