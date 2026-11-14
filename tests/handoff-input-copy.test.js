import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../src/controller.js';
test('handoff validates the snapshot it stores, not the caller object it read first', () => {
    const c = new VoiceController({
        sessionId: 'a'.repeat(32)
    });
    c.connected();
    let reads = 0;
    const entry = {
        id: 'u1', role: 'user', source: 'typed', completion: 'complete',
        get text() {
            return ++reads === 1 ? 'short' : 'x'.repeat(600);
        }
    };
    const before = c.getState();
    assert.throws(() => c.beginHandoff({
        reason: 'user_requested', history: [entry], slots: {
            topic: null, reference: null
        }
    }), /invalid_input/);
    assert.deepEqual(c.getState(), before);
});
