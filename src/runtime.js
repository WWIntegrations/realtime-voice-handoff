/** Browser runtime. Four WebRTC endpoints, real PCM, and no inference provider. */
import { VoiceController } from './controller.js';
import { HandoffProtocol } from './protocol.js';
import { AudioTracks } from './audio-tracks.js';
import { probeSource } from './audio-probe.js';
import { RtcPair } from './rtc.js';
import { encodeWire, invalid } from './schema.js';
import { parseWav } from './wav.js';
import { RemoteMediaSink } from './media-sink.js';
export function createVoiceLab() {
    return createLabRuntime().api;
}
/** Dependency injection is for the test harness; normal UI uses createVoiceLab. */
export function createLabRuntime({ audioFactory = context => new AudioTracks(context) } = {}) {
    let context = null, tracks = null, protocol = null, pairs = {}, master = null, connectPromise = null, connectTimer = null, rejectConnect = null;
    let volume = .8, sequence = 0, assetNumber = 0, record = null, recordToken = 0, lastRecordingId = null;
    const buffers = new Map(), listeners = new Set(), events = [], nodes = [], urls = new Set(), remoteMediaSinks = [];
    // Imported and recorded clips are each up to ten seconds; keep only the most recent ones.
    const LOCAL_AUDIO_LIMIT = 8, localIds = [];
    function storeLocal(id, buffer) {
        buffers.set(id, buffer);
        localIds.push(id);
        while (localIds.length > LOCAL_AUDIO_LIMIT)
            buffers.delete(localIds.shift());
    }
    const probes = Object.fromEntries(['mix', 'triage', 'specialist'].map(name => [name, {
            windows: [], rms: 0, waveform: Array(64).fill(0), lastEndTime: 0
        }]));
    const controller = new VoiceController({
        onChange: () => {
            const state = controller.getState();
            if (tracks)
                for (const role of ['triage', 'specialist'])
                    if (state.cancelled[role])
                        tracks.cancel(role);
            if (state.state === 'failed') {
                rejectConnect?.(new Error(state.lastError || 'transport'));
                void cleanup();
            }
            emit('state');
        }
    });
    function state() {
        return {
            ...controller.getState(), receivedSnapshot: protocol?.getReceived() ?? null, recording: Boolean(record), lastRecordingId
        };
    }
    function emit(type, detail = {}) {
        const s = state();
        const event = {
            sequence: ++sequence, type, at: performance.now(), audioTime: context?.currentTime ?? null, state: s, ...detail
        };
        events.push({
            sequence: event.sequence, type, at: event.at, audioTime: event.audioTime, state: s.state, owner: s.owner, epoch: s.epoch
        });
        if (events.length > 256)
            events.shift();
        for (const listener of listeners) {
            try {
                listener(structuredClone(event));
            }
            catch {
            }
        }
    }
    function createProbe(name) {
        const node = new AudioWorkletNode(context, 'voice-pcm-probe', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', processorOptions: {
                mode: 'probe'
            }
        });
        node.port.onmessage = event => {
            if (event.data.type !== 'window' || ['closed', 'failed'].includes(controller.getState().state))
                return;
            const { type, ...window } = event.data, p = probes[name];
            p.rms = window.rms;
            p.waveform = window.waveform;
            p.lastEndTime = window.endTime;
            p.windows.push({
                startTime: window.startTime, endTime: window.endTime, rms: window.rms, samples: window.samples
            });
            if (p.windows.length > 2000)
                p.windows.shift();
        };
        nodes.push(node);
        return node;
    }
    function audioBuffer(samples, rate) {
        const buffer = context.createBuffer(1, samples.length, rate);
        buffer.copyToChannel(samples, 0);
        return buffer;
    }
    function tone(frequency) {
        const samples = new Float32Array(96000);
        for (let i = 0; i < samples.length; i++)
            samples[i] = .2 * Math.sin(2 * Math.PI * frequency * i / 48000);
        return audioBuffer(samples, 48000);
    }
    function fail(code = 'transport') {
        controller.fail(code);
    }
    function sendInterrupt(reason) {
        const s = controller.getState();
        if (!pairs.T || pairs.T.closed)
            return;
        try {
            pairs.T.send(encodeWire({
                type: 'interrupt', schema_version: 1, session_id: s.session_id, epoch: s.epoch, turn_id: s.turn_id, reason
            }));
        }
        catch {
            fail('transport');
        }
    }
    async function connect() {
        if (controller.getState().state === 'closed')
            invalid('closed');
        if (connectPromise)
            return connectPromise;
        if (controller.getState().state !== 'connecting')
            invalid('busy');
        const lease = controller.lease();
        const cancelled = new Promise((_, reject) => {
            rejectConnect = reject;
        });
        const initializing = (async () => {
            connectTimer = setTimeout(() => fail('timeout'), 5000);
            try {
                const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
                if (!Context)
                    invalid('transport');
                context = new Context({
                    sampleRate: 48000, latencyHint: 'interactive'
                });
                await context.resume();
                if (!controller.matches(lease) || controller.getState().state !== 'connecting')
                    invalid('closed');
                if (context.state !== 'running')
                    invalid('audio_blocked');
                const url = URL.createObjectURL(new Blob([probeSource()], {
                    type: 'text/javascript'
                }));
                urls.add(url);
                await context.audioWorklet.addModule(url);
                URL.revokeObjectURL(url);
                urls.delete(url);
                if (!controller.matches(lease) || controller.getState().state !== 'connecting')
                    invalid('closed');
                tracks = audioFactory(context);
                master = context.createGain();
                master.gain.value = volume;
                nodes.push(master);
                const mix = createProbe('mix');
                master.connect(mix);
                mix.connect(context.destination);
                buffers.set('triage-tone', tone(440));
                buffers.set('specialist-tone', tone(880));
                protocol = new HandoffProtocol({
                    controller, send: bytes => pairs.S.send(bytes),
                    onPending: () => sendInterrupt('handoff'), onEvent: type => emit(type)
                });
                async function receiver(role, track, stream) {
                    if (['closed', 'failed'].includes(controller.getState().state)) {
                        track.stop();
                        return;
                    }
                    const source = context.createMediaStreamSource(stream), gate = context.createGain(), probe = createProbe(role);
                    tracks.attachReceiver(role, gate);
                    source.connect(gate);
                    gate.connect(probe);
                    probe.connect(master);
                    nodes.push(source, gate);
                    const sink = new RemoteMediaSink(stream);
                    remoteMediaSinks.push(sink);
                    await sink.start();
                }
                pairs.T = new RtcPair({
                    name: 'T', stream: tracks.stream('triage'), onTrack: (...args) => receiver('triage', ...args),
                    onCallerMessage: () => {
                    }, onRemoteMessage: bytes => {
                        if (protocol.receiveInterrupt(bytes))
                            tracks.cancel('triage');
                    }, onFailure: code => fail(code)
                });
                pairs.S = new RtcPair({
                    name: 'S', stream: tracks.stream('specialist'), onTrack: (...args) => receiver('specialist', ...args),
                    onCallerMessage: bytes => protocol.receiveAck(bytes), onRemoteMessage: async (bytes) => {
                        const ack = await protocol.receiveSnapshot(bytes);
                        if (ack)
                            pairs.S.reply(ack);
                    }, onFailure: code => fail(code)
                });
                await Promise.all([pairs.T.connect(), pairs.S.connect()]);
                if (!controller.matches(lease) || controller.getState().state !== 'connecting')
                    invalid('closed');
                clearTimeout(connectTimer);
                controller.connected();
                emit('connected');
                return state();
            }
            catch (error) {
                clearTimeout(connectTimer);
                if (controller.getState().state !== 'closed')
                    fail(error.message === 'audio_blocked' ? 'audio_blocked' : error.message === 'timeout' ? 'timeout' : 'transport');
                await cleanup();
                throw new Error(controller.getState().state === 'closed' ? 'closed' : controller.getState().lastError || 'transport');
            }
        })();
        connectPromise = Promise.race([initializing, cancelled]).finally(() => {
            rejectConnect = null;
            clearTimeout(connectTimer);
        });
        return connectPromise;
    }
    function play(audioId) {
        if (!context || context.state !== 'running' || !tracks)
            invalid('busy');
        const buffer = buffers.get(audioId);
        if (!buffer)
            invalid('invalid_input');
        const lease = controller.play(audioId, Math.ceil(buffer.duration * 1000));
        try {
            tracks.play(lease.owner, buffer, {
                audioId, turnId: lease.turn_id, onEnded: () => {
                    if (controller.finished(lease))
                        emit('audio_ended');
                }
            });
        }
        catch {
            fail();
            invalid('transport');
        }
        emit('audio_started', {
            audioId
        });
        return state();
    }
    function interrupt(reason = 'manual') {
        if (!['manual', 'energy', 'handoff'].includes(reason))
            invalid();
        const before = controller.getState();
        const t0 = context?.currentTime ?? null;
        const position = before.owner && tracks ? tracks.position(before.owner, reason) : null;
        if (!controller.interrupt(reason))
            return {
                t0, position, remainingMs: position ? position.duration_ms - position.played_ms : null
            };
        if (before.owner === 'triage')
            sendInterrupt(reason);
        emit('interrupted', {
            t0, position
        });
        return {
            t0, position, remainingMs: position ? position.duration_ms - position.played_ms : null
        };
    }
    async function requestHandoff(input) {
        if (!protocol)
            invalid('busy');
        const position = tracks.position('triage', 'handoff');
        return protocol.request(input, position);
    }
    function importWav(buffer) {
        if (!context || ['closed', 'failed', 'connecting'].includes(controller.getState().state))
            invalid('busy');
        const parsed = parseWav(buffer), id = `local-audio-${++assetNumber}`;
        storeLocal(id, audioBuffer(parsed.samples, parsed.sampleRate));
        emit('audio_imported', {
            audioId: id, durationMs: parsed.durationMs
        });
        return id;
    }
    function disposeRecord(rec) {
        clearTimeout(rec.timer);
        for (const track of rec.stream?.getTracks() ?? [])
            track.stop();
        for (const node of [rec.source, rec.worklet, rec.zero]) {
            try {
                node?.disconnect();
            }
            catch {
            }
        }
        if (rec.worklet)
            rec.worklet.port.onmessage = null;
    }
    function finishRecord(rec, cancel = false) {
        if (record !== rec)
            return;
        record = null;
        recordToken++;
        disposeRecord(rec);
        if (cancel || rec.count === 0 || !context || context.state === 'closed') {
            rec.resolve?.(null);
            emit('recording_stopped', {
                audioId: null
            });
            return;
        }
        const samples = new Float32Array(rec.count);
        let offset = 0;
        for (const chunk of rec.chunks) {
            samples.set(chunk, offset);
            offset += chunk.length;
        }
        const id = `recorded-audio-${++assetNumber}`;
        storeLocal(id, audioBuffer(samples, 48000));
        lastRecordingId = id;
        rec.resolve?.(id);
        emit('recording_stopped', {
            audioId: id
        });
    }
    async function startRecording() {
        if (record || !context || context.state !== 'running' || !['active_triage', 'active_specialist'].includes(controller.getState().state))
            invalid('busy');
        if (!globalThis.navigator?.mediaDevices?.getUserMedia)
            invalid('permission_denied');
        const token = ++recordToken, rec = {
            stream: null, source: null, worklet: null, chunks: [], count: 0, resolve: null
        };
        record = rec;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1, echoCancellation: true
                }, video: false
            });
            if (record !== rec || recordToken !== token || context.state !== 'running') {
                for (const t of stream.getTracks())
                    t.stop();
                invalid('closed');
            }
            if (context.sampleRate !== 48000) {
                for (const t of stream.getTracks())
                    t.stop();
                invalid('unsupported_audio');
            }
            rec.stream = stream;
            rec.source = context.createMediaStreamSource(stream);
            rec.worklet = new AudioWorkletNode(context, 'voice-pcm-probe', {
                numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', processorOptions: {
                    mode: 'record', maxSamples: 480000
                }
            });
            rec.zero = context.createGain();
            rec.zero.gain.value = 0;
            rec.source.connect(rec.worklet);
            rec.worklet.connect(rec.zero);
            rec.zero.connect(context.destination);
            rec.worklet.port.onmessage = event => {
                if (record !== rec)
                    return;
                if (event.data.type === 'pcm') {
                    const chunk = event.data.samples;
                    if (!(chunk instanceof Float32Array) || rec.count + chunk.length > 480000) {
                        finishRecord(rec, true);
                        return;
                    }
                    rec.chunks.push(chunk);
                    rec.count += chunk.length;
                }
                else if (event.data.type === 'done')
                    finishRecord(rec);
            };
            rec.timer = setTimeout(() => {
                if (record === rec)
                    rec.worklet.port.postMessage({
                        type: 'stop'
                    });
            }, 10000);
            emit('recording_started');
            return true;
        }
        catch (error) {
            if (record === rec) {
                record = null;
                disposeRecord(rec);
            }
            emit('recording_error', {
                code: error.message === 'unsupported_audio' ? 'unsupported_audio' : 'permission_denied'
            });
            throw new Error(error.message === 'closed' ? 'closed' : error.message === 'unsupported_audio' ? 'unsupported_audio' : 'permission_denied');
        }
    }
    function stopRecording() {
        if (!record)
            return Promise.resolve(lastRecordingId);
        if (!record.worklet)
            invalid('busy');
        if (record.promise)
            return record.promise;
        record.promise = new Promise(resolve => {
            record.resolve = resolve;
        });
        record.worklet.port.postMessage({
            type: 'stop'
        });
        return record.promise;
    }
    function cancelRecording() {
        if (record)
            finishRecord(record, true);
        else
            recordToken++;
    }
    async function cleanup() {
        clearTimeout(connectTimer);
        cancelRecording();
        protocol?.dispose();
        for (const pair of Object.values(pairs))
            pair.close();
        tracks?.close();
        for (const sink of remoteMediaSinks)
            sink.close();
        for (const node of nodes) {
            try {
                node.disconnect();
            }
            catch {
            }
        }
        for (const url of urls)
            URL.revokeObjectURL(url);
        urls.clear();
        if (context && context.state !== 'closed') {
            try {
                await context.close();
            }
            catch {
            }
        }
    }
    async function close() {
        controller.close();
        rejectConnect?.(new Error('closed'));
        await cleanup();
        buffers.clear();
        localIds.length = 0;
    }
    function setVolume(value) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
            invalid();
        volume = value;
        if (master)
            master.gain.setValueAtTime(volume, context.currentTime);
        emit('volume_changed');
    }
    async function getMetrics() {
        const transport = {};
        for (const [name, pair] of Object.entries(pairs)) {
            try {
                transport[name] = await pair.metrics();
            }
            catch {
                transport[name] = {
                    connectionState: pair.caller.connectionState, channelState: pair.callerChannel.readyState, selectedPair: null, inbound: null
                };
            }
        }
        const alive = context?.state === 'running' && !['closed', 'failed'].includes(controller.getState().state);
        return {
            contextTime: context?.currentTime ?? null, sampleRate: context?.sampleRate ?? null, masterVolume: volume,
            probes: Object.fromEntries(Object.entries(probes).map(([name, p]) => [name, {
                    ...structuredClone(p), fresh: Boolean(alive && context.currentTime - p.lastEndTime < .1)
                }])),
            transport, audio: tracks?.describe() ?? {}, events: structuredClone(events)
        };
    }
    const api = {
        connect, play, interrupt, requestHandoff, close, getState: state, getMetrics, setVolume, importWav, startRecording, stopRecording, cancelRecording,
        subscribe(listener) {
            if (typeof listener !== 'function')
                invalid();
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
    return {
        api, diagnostic: {
            get context() {
                return context;
            }, get tracks() {
                return tracks;
            }, get pairs() {
                return pairs;
            }, get protocol() {
                return protocol;
            }, get controller() {
                return controller;
            }, buffer: id => buffers.get(id)
        }
    };
}
