import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabRuntime } from '../src/runtime.js';
test('cancelling while the microphone prompt is open is not reported as a permission denial', async (t) => {
    const previous = globalThis.AudioContext;
    globalThis.AudioContext = class {
        constructor() {
            this.state = 'running';
            this.currentTime = 0;
            this.sampleRate = 48000;
            this.audioWorklet = {
                addModule: () => new Promise(() => {
                })
            };
        }
        async resume() {
        }
        async close() {
            this.state = 'closed';
        }
    };
    let grant;
    let stopped = 0;
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true, value: {
            getUserMedia: () => new Promise(resolve => {
                grant = resolve;
            })
        }
    });
    t.after(() => {
        globalThis.AudioContext = previous;
        delete globalThis.navigator.mediaDevices;
    });
    const runtime = createLabRuntime(), lab = runtime.api;
    const pending = lab.connect().catch(() => {
    });
    await new Promise(setImmediate);
    runtime.diagnostic.controller.connected();
    const seen = [];
    lab.subscribe(event => {
        if (event.type === 'recording_error')
            seen.push(event.code);
    });
    const recording = lab.startRecording();
    lab.cancelRecording();
    grant({
        getTracks: () => [{
                stop: () => stopped++
            }]
    });
    await assert.rejects(recording, /closed/);
    assert.equal(stopped, 1);
    assert.deepEqual(seen, ['closed']);
    await lab.close();
    await pending;
});
