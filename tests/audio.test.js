import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { RmsAccumulator, assessSilence, probeSource } from '../src/audio-probe.js';
import { AudioTracks } from '../src/audio-tracks.js';
test('PCM windows use exact sample counts and measured energy', () => {
    const probe = new RmsAccumulator(48000), out = [];
    for (let frame = 0; frame < 1920; frame += 128)
        out.push(...probe.push(new Float32Array(128).fill(.2), frame));
    assert.equal(out.length, 2);
    assert.equal(out[0].samples, 960);
    assert.equal(out[0].startTime, 0);
    assert.equal(out[0].endTime, .02);
    assert.ok(Math.abs(out[0].rms - .2) < 1e-7);
    assert.equal(out[0].waveform.length, 64);
});
test('silence check requires received signal, remaining audio and full post windows', () => {
    const windows = Array.from({
        length: 80
    }, (_, i) => ({
        startTime: i * .02, endTime: (i + 1) * .02, rms: i < 20 ? .1 : 0, samples: 960
    }));
    assert.equal(assessSilence(windows, .4, 1500).status, 'PASS');
    assert.equal(assessSilence(windows, .4, 900).status, 'INVALID');
    assert.equal(assessSilence(windows.map(w => ({
        ...w, rms: 0
    })), .4, 1500).status, 'INVALID');
    assert.equal(assessSilence(windows.map(w => ({
        ...w, rms: .1
    })), .4, 1500).status, 'FAIL');
    assert.equal(assessSilence(windows.slice(0, 25), .4, 1500).status, 'INVALID');
});
test('real worklet source passes PCM unchanged and emits RMS windows', () => {
    let Processor;
    const messages = [];
    const context = {
        AudioWorkletProcessor: class {
            constructor() {
                this.port = {
                    postMessage: m => messages.push(m)
                };
            }
        },
        registerProcessor: (name, ctor) => {
            Processor = ctor;
        }, sampleRate: 48000, currentFrame: 0, Float32Array, Math
    };
    vm.runInNewContext(probeSource(), context);
    const p = new Processor({
        processorOptions: {
            mode: 'probe'
        }
    });
    for (let frame = 0; frame < 1024; frame += 128) {
        context.currentFrame = frame;
        const input = new Float32Array(128).fill(.25), output = new Float32Array(128);
        p.process([[input]], [[output]]);
        assert.deepEqual(output, input);
    }
    assert.equal(messages[0].type, 'window');
    assert.ok(Math.abs(messages[0].rms - .25) < 1e-7);
});
test('recording worklet stops at sample cap and never monitors input', () => {
    let Processor;
    const messages = [];
    const context = {
        AudioWorkletProcessor: class {
            constructor() {
                this.port = {
                    postMessage: m => messages.push(m)
                };
            }
        },
        registerProcessor: (name, ctor) => {
            Processor = ctor;
        }, sampleRate: 48000, currentFrame: 0, Float32Array, Math
    };
    vm.runInNewContext(probeSource(), context);
    const p = new Processor({
        processorOptions: {
            mode: 'record', maxSamples: 200
        }
    });
    for (let i = 0; i < 4; i++) {
        const output = new Float32Array(128);
        p.process([[new Float32Array(128).fill(.3)]], [[output]]);
        assert.ok(output.every(x => x === 0));
    }
    assert.equal(messages.filter(m => m.type === 'pcm').reduce((n, m) => n + m.samples.length, 0), 200);
    assert.equal(messages.filter(m => m.type === 'done').length, 1);
});
function fakeContext() {
    const nodes = [];
    return {
        currentTime: 0, sampleRate: 48000, nodes,
        createGain() {
            return {
                gain: {
                    value: 1, setValueAtTime(value) {
                        this.value = value;
                    }
                }, connect() {
                }, disconnect() {
                }
            };
        },
        createMediaStreamDestination() {
            return {
                stream: {
                    getTracks: () => [{
                            stop() {
                            }
                        }]
                }, disconnect() {
                }
            };
        },
        createBufferSource() {
            const node = {
                buffer: null, connect() {
                }, disconnect() {
                }, start(t) {
                    this.startAt = t;
                }, stop() {
                    this.stopped = true;
                }
            };
            nodes.push(node);
            return node;
        }
    };
}
test('audio cancellation stops active and scheduled sources and permanently mutes old receiver', () => {
    const context = fakeContext(), tracks = new AudioTracks(context), gate = context.createGain();
    tracks.attachReceiver('triage', gate);
    tracks.play('triage', {
        duration: 2
    }, {
        audioId: 'tone', turnId: 1
    });
    tracks.scheduleFragment('triage', {
        duration: 2
    }, .5);
    context.currentTime = .3;
    const result = tracks.cancel('triage', 'manual');
    assert.equal(context.nodes[0].startAt, .03);
    assert.equal(result.played_ms, 270);
    assert.equal(gate.gain.value, 0);
    assert.ok(context.nodes.every(n => n.stopped));
    assert.throws(() => tracks.play('triage', {
        duration: 2
    }, {
        audioId: 'tone', turnId: 2
    }));
    const newGate = context.createGain();
    tracks.attachReceiver('triage', newGate);
    assert.equal(newGate.gain.value, 0);
    tracks.attachReceiver('specialist', context.createGain());
    tracks.play('specialist', {
        duration: 2
    }, {
        audioId: 'tone2', turnId: 2
    });
    assert.equal(tracks.describe().specialist.cancelled, false);
    tracks.close();
});
