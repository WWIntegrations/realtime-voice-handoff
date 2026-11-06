import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWire, encodeWire, validateMessage } from '../src/schema.js';
import { VoiceController } from '../src/controller.js';
import { HandoffProtocol } from '../src/protocol.js';
const session = 'a'.repeat(32);
const input = () => ({
    reason: 'user_requested', history: [{
            id: 'u', role: 'user', text: 'original', source: 'typed', completion: 'complete'
        }], slots: {
        topic: null, reference: null
    }
});
const controller = () => {
    const c = new VoiceController({
        sessionId: session
    });
    c.connected();
    return c;
};
test('identifiers, sessions and digests reject trailing newline and non-string coercion', () => {
    const m = {
        type: 'handoff_ack', schema_version: 1, session_id: session, handoff_id: 'h', epoch: 1, snapshot_digest: 'b'.repeat(64)
    };
    for (const key of ['session_id', 'handoff_id', 'snapshot_digest'])
        assert.throws(() => validateMessage({
            ...m, [key]: m[key] + '\n'
        }));
    assert.throws(() => new VoiceController({
        sessionId: session + '\n'
    }));
    for (const id of [undefined, 123, {}, 'audio\n'])
        assert.throws(() => controller().play(id, 100));
    const c = controller();
    c.beginHandoff(input());
    assert.throws(() => c.setDigest(c.lease(), 'b'.repeat(64) + '\n'));
});
test('wire rejects fractional and exponent integer spellings before numeric rounding', () => {
    for (const token of ['1.00000000000000001', '1.0', '1e0', '9007199254740993']) {
        assert.throws(() => decodeWire(new TextEncoder().encode(`{"epoch":${token}}`)), /invalid_input/);
    }
});
test('failing pending effect terminates the transaction instead of leaving an unbounded wait', async () => {
    const c = controller(), p = new HandoffProtocol({
        controller: c, send: () => {
        }, onPending: () => {
            throw new Error('test');
        }
    });
    assert.equal(await p.request(input()), false);
    assert.equal(c.getState().state, 'failed');
    assert.equal(c.getState().pending, null);
    p.dispose();
});
test('pending effect receives a copy and cannot rewrite the snapshot being acknowledged', async () => {
    const c = controller();
    let sent;
    const p = new HandoffProtocol({
        controller: c, send: value => {
            sent = value;
        }, onPending: p => {
            p.history[0].text = 'changed';
        }
    });
    await p.request(input());
    assert.equal(decodeWire(sent).payload.history[0].text, 'original');
    assert.equal(c.getState().pending.payload.history[0].text, 'original');
    p.dispose();
});
