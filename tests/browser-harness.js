/** Browser integration only. Fault injection is never imported by normal UI. */
import { createLabRuntime } from '../src/runtime.js';
import { AudioTracks } from '../src/audio-tracks.js';
import { assessSilence } from '../src/audio-probe.js';
import { decodeWire, encodeWire } from '../src/schema.js';
class BrokenCancellation extends AudioTracks {
    cancel(role, reason = 'manual') {
        return this.position(role, reason);
    }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition, timeout = 5000) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
        const value = await condition();
        if (value)
            return value;
        await delay(20);
    }
    throw new Error('test_timeout');
}
function iceEvidence(metrics) {
    return Object.fromEntries(['T', 'S'].map(name => {
        const transport = metrics.transport[name], pair = transport?.selectedPair;
        return [name, {
                ...transport, complete: Boolean(pair && pair.state === 'succeeded' && pair.nominated === true && pair.localType === 'host' && pair.remoteType === 'host')
            }];
    }));
}
async function cancellationScenario(broken) {
    const runtime = createLabRuntime(broken ? {
        audioFactory: context => new BrokenCancellation(context)
    } : {}), lab = runtime.api;
    let stage = 'connect';
    try {
        await lab.connect();
        lab.subscribe(() => {
            throw new Error('deliberate UI listener failure');
        });
        stage = 'received_signal_precondition';
        const before = await lab.getMetrics();
        lab.play('triage-tone');
        await until(async () => {
            const m = await lab.getMetrics();
            const windows = m.probes.mix.windows.slice(-10);
            return windows.length === 10 && windows.every(w => w.rms >= .05);
        }, 1200);
        runtime.diagnostic.tracks.scheduleFragment('triage', runtime.diagnostic.buffer('triage-tone'), runtime.diagnostic.context.currentTime + .5);
        const interrupted = lab.interrupt('manual');
        stage = 'post_interrupt_observation';
        await until(async () => runtime.diagnostic.context.currentTime >= interrupted.t0 + 1.1, 2000);
        const metrics = await lab.getMetrics(), measurement = assessSilence(metrics.probes.mix.windows, interrupted.t0, interrupted.remainingMs);
        const oldWindows = metrics.probes.triage.windows.filter(w => w.startTime >= interrupted.t0 + .1 && w.endTime <= interrupted.t0 + 1.1);
        const oldTrackSilent = oldWindows.length >= 45 && oldWindows.every(w => w.rms <= .001);
        const transport = iceEvidence(metrics), rtp = metrics.transport.T.inbound;
        return {
            expected: broken ? 'FAIL' : 'PASS', measurement, oldTrackSilent, oldTrackWindows: oldWindows,
            transport, rtpReceived: rtp.bytesReceived > (before.transport.T.inbound?.bytesReceived ?? 0) && rtp.packetsReceived > 0,
            state: lab.getState(), t0: interrupted.t0, remainingMs: interrupted.remainingMs
        };
    }
    catch (error) {
        error.diagnostics = {
            scenario: broken ? 'negative' : 'positive', stage, state: lab.getState(), metrics: await lab.getMetrics()
        };
        throw error;
    }
    finally {
        await lab.close();
    }
}
async function handoffScenario() {
    const runtime = createLabRuntime(), lab = runtime.api;
    let stage = 'connect';
    try {
        await lab.connect();
        lab.play('triage-tone');
        stage = 'triage_received_signal';
        await until(async () => {
            const m = await lab.getMetrics();
            return m.probes.mix.windows.slice(-10).filter(w => w.rms >= .05).length === 10;
        }, 1200);
        const history = [{
                id: 'u1', role: 'user', text: 'Transfer this local test.', source: 'fixture', completion: 'complete'
            }];
        await lab.requestHandoff({
            reason: 'scripted_scenario', history, slots: {
                topic: 'technical', reference: 'local-case'
            }
        });
        history[0].text = 'caller mutation after request';
        stage = 'ack_received';
        await until(() => lab.getState().state === 'active_specialist');
        const acknowledged = lab.getState(), beforePlay = await lab.getMetrics();
        const p = runtime.diagnostic.protocol, received = p.getReceived();
        const ack = {
            type: 'handoff_ack', schema_version: 1, session_id: received.session_id, handoff_id: received.handoff_id, epoch: received.epoch, snapshot_digest: p.receivedDigest
        };
        runtime.diagnostic.pairs.S.reply(encodeWire(ack));
        runtime.diagnostic.pairs.S.reply(encodeWire({
            ...ack, epoch: ack.epoch + 1
        }));
        lab.play('specialist-tone');
        stage = 'specialist_received_signal';
        await until(async () => {
            const m = await lab.getMetrics();
            return m.probes.specialist.windows.slice(-10).filter(w => w.rms >= .05).length === 10;
        }, 1500);
        const metrics = await lab.getMetrics();
        const result = {
            acknowledged, receivedSnapshot: received, beforePlaySpecialistRms: beforePlay.probes.specialist.rms,
            specialistRms: metrics.probes.specialist.rms, triageRms: metrics.probes.triage.rms, transport: iceEvidence(metrics),
            events: metrics.events, immutableHistory: received.history[0].text === 'Transfer this local test.',
            duplicateSeen: metrics.events.some(e => e.type === 'ack_duplicate'), staleSeen: metrics.events.some(e => e.type === 'ack_stale')
        };
        await lab.close();
        result.closedState = lab.getState();
        result.closedMetrics = await lab.getMetrics();
        return result;
    }
    catch (error) {
        error.diagnostics = {
            scenario: 'handoff', stage, state: lab.getState(), metrics: await lab.getMetrics()
        };
        throw error;
    }
    finally {
        await lab.close();
    }
}
export async function runBrowserChecks() {
    const checks = [];
    const result = {
        done: false, ok: false, checks, startedAt: new Date().toISOString()
    };
    try {
        const positive = await cancellationScenario(false);
        result.positive = positive;
        checks.push({
            name: 'real RTP and selected local ICE pairs', ok: positive.rtpReceived && Object.values(positive.transport).every(p => p.complete)
        });
        checks.push({
            name: 'interruption reaches measured PCM silence with throwing subscriber', ok: positive.measurement.status === 'PASS' && positive.oldTrackSilent
        });
        const negative = await cancellationScenario(true);
        result.negative = negative;
        checks.push({
            name: 'broken cancellation is detected', ok: negative.measurement.status === 'FAIL' && !negative.oldTrackSilent && negative.remainingMs >= 1000
        });
        const handoff = await handoffScenario();
        result.handoff = handoff;
        checks.push({
            name: 'snapshot and ACK traverse DataChannel before playback', ok: handoff.immutableHistory && handoff.acknowledged.playback === 'silent' && handoff.beforePlaySpecialistRms <= .001 && handoff.events.some(e => e.type === 'snapshot_received') && handoff.events.some(e => e.type === 'ack_accepted')
        });
        checks.push({
            name: 'specialist audio uses separate track and old role remains muted', ok: handoff.specialistRms >= .05 && handoff.triageRms <= .001
        });
        checks.push({
            name: 'duplicate and stale ACK do not restart playback', ok: handoff.duplicateSeen && handoff.staleSeen
        });
        checks.push({
            name: 'close invalidates probes and peers', ok: handoff.closedState.state === 'closed' && Object.values(handoff.closedMetrics.transport).every(p => p.connectionState === 'closed') && Object.values(handoff.closedMetrics.probes).every(p => !p.fresh)
        });
        result.ok = checks.every(check => check.ok);
    }
    catch (error) {
        result.error = String(error.message);
        result.diagnostics = error.diagnostics ?? null;
        checks.push({
            name: 'harness completed', ok: false
        });
    }
    result.done = true;
    return result;
}
