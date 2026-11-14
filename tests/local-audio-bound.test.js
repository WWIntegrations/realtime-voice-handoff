import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabRuntime } from '../src/runtime.js';
import { encodeWav } from '../src/wav.js';
test('imported local clips are bounded: only the most recent ones stay in memory', async (t) => {
    const previous = globalThis.AudioContext;
    globalThis.AudioContext = class {
        constructor() {
            this.state = 'running';
            this.currentTime = 0;
            this.sampleRate = 48000;
            // Startup never finishes; the controller is moved to active by hand below.
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
        createBuffer(channels, length, sampleRate) {
            return {
                length, sampleRate, duration: length / sampleRate, copyToChannel() {
                }
            };
        }
    };
    t.after(() => {
        globalThis.AudioContext = previous;
    });
    const runtime = createLabRuntime(), lab = runtime.api;
    const pending = lab.connect().catch(() => {
    });
    await new Promise(setImmediate);
    runtime.diagnostic.controller.connected();
    const wav = encodeWav(new Float32Array(4800));
    const ids = Array.from({
        length: 40
    }, () => lab.importWav(wav.slice(0)));
    const kept = ids.filter(id => runtime.diagnostic.buffer(id));
    assert.ok(kept.length <= 8, `kept ${kept.length} clips`);
    assert.deepEqual(kept, ids.slice(-kept.length));
    assert.ok(runtime.diagnostic.buffer(ids.at(-1)));
    await lab.close();
    await pending;
});
