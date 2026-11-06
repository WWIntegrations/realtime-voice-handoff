import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceLab } from '../src/runtime.js';
test('deadline settles connect even while browser resume never resolves', async (t) => {
    const previous = globalThis.AudioContext;
    globalThis.AudioContext = class {
        constructor() {
            this.state = 'suspended';
            this.currentTime = 0;
        }
        resume() {
            return new Promise(() => {
            });
        }
        async close() {
            this.state = 'closed';
        }
    };
    t.after(() => {
        globalThis.AudioContext = previous;
    });
    t.mock.timers.enable({
        apis: ['setTimeout']
    });
    const lab = createVoiceLab();
    let outcome = null;
    const pending = lab.connect().catch(error => {
        outcome = error.message;
    });
    t.mock.timers.tick(5000);
    await new Promise(setImmediate);
    assert.equal(outcome, 'timeout');
    assert.equal(lab.getState().state, 'failed');
    await pending;
    await lab.close();
});
test('close settles pending worklet startup and late completion cannot create media', async (t) => {
    const previous = globalThis.AudioContext;
    let resolveModule;
    let createdMedia = false;
    globalThis.AudioContext = class {
        constructor() {
            this.state = 'running';
            this.currentTime = 0;
            this.audioWorklet = {
                addModule: () => new Promise(resolve => {
                    resolveModule = resolve;
                })
            };
        }
        async resume() {
        }
        async close() {
            this.state = 'closed';
        }
        createGain() {
            createdMedia = true;
            throw new Error('should not run');
        }
    };
    t.after(() => {
        globalThis.AudioContext = previous;
    });
    const lab = createVoiceLab();
    let outcome = null;
    const pending = lab.connect().catch(error => {
        outcome = error.message;
    });
    await new Promise(setImmediate);
    await lab.close();
    await new Promise(setImmediate);
    assert.equal(outcome, 'closed');
    resolveModule();
    await new Promise(setImmediate);
    assert.equal(createdMedia, false);
    await pending;
});
