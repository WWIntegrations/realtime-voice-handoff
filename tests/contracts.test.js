import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, decodeWire, encodeWire, sha256, validatePayload, validateMessage } from '../src/schema.js';
import { parseWav, encodeWav } from '../src/wav.js';
import { VoiceController } from '../src/controller.js';
import { HandoffProtocol } from '../src/protocol.js';
export const SESSION = 'a'.repeat(32);
export function payload(overrides = {}) {
    return {
        session_id: SESSION, handoff_id: 'handoff-1', epoch: 1, turn_id: 0,
        owner: 'triage', from: 'triage', to: 'specialist', reason: 'user_requested',
        history: [{
                id: 'u1', role: 'user', text: 'Please transfer.', source: 'typed', completion: 'complete'
            }],
        slots: {
            topic: 'technical', reference: 'case-1'
        }, interrupted_audio: null, ...overrides
    };
}
const input = () => ({
    reason: 'user_requested', history: payload().history, slots: payload().slots
});
function ready() {
    let time = 0;
    const c = new VoiceController({
        sessionId: SESSION, now: () => time
    });
    c.connected();
    return {
        c, clock: t => {
            time = t;
        }
    };
}
function ack(c) {
    const p = c.getState().pending;
    return {
        type: 'handoff_ack', schema_version: 1, session_id: p.session_id, handoff_id: p.handoff_id, epoch: p.epoch, snapshot_digest: p.snapshot_digest
    };
}
test('strict wire rejects duplicate keys, malformed UTF8, extra fields and nonfinite', () => {
    for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', 'NaN', '{"x":1e999}', '{"x":"\\ud800"}', '{} garbage']) {
        assert.throws(() => decodeWire(new TextEncoder().encode(text)), /invalid_input/);
    }
    assert.throws(() => decodeWire(new Uint8Array([255])), /invalid_input/);
    assert.throws(() => decodeWire(new TextEncoder().encode('['.repeat(9) + '0' + ']'.repeat(9))), /invalid_input/);
    assert.throws(() => decodeWire(new Uint8Array(16385)), /invalid_input/);
    const message = {
        type: 'handoff_ack', schema_version: 1, session_id: SESSION, handoff_id: 'h', epoch: 1, snapshot_digest: 'b'.repeat(64)
    };
    assert.deepEqual(decodeWire(encodeWire(message)), message);
    assert.throws(() => validateMessage({
        ...message, extra: 1
    }), /invalid_input/);
    assert.throws(() => validateMessage({
        ...message, epoch: true
    }), /invalid_input/);
});
test('payload fields, history uniqueness and canonical byte budget are closed', () => {
    validatePayload(payload());
    for (const change of [{
            slots: {
                topic: 'technical', reference: null, extra: true
            }
        }, {
            epoch: 0
        }, {
            session_id: 'x'
        }, {
            to: 'unknown'
        },
        {
            history: [...payload().history, ...payload().history]
        }, {
            history: Array.from({
                length: 33
            }, (_, i) => ({
                ...payload().history[0], id: `u${i}`
            }))
        }]) {
        assert.throws(() => validatePayload(payload(change)), /invalid_input/);
    }
    const large = payload({
        history: Array.from({
            length: 32
        }, (_, i) => ({
            ...payload().history[0], id: `u${i}`, text: '😀'.repeat(512)
        }))
    });
    validatePayload(large);
    assert.throws(() => encodeWire({
        type: 'handoff_snapshot', schema_version: 1, payload: large, snapshot_digest: '0'.repeat(64)
    }), /invalid_input/);
});
test('canonical digest ignores object key order, retains array order and Unicode', async () => {
    assert.equal(canonical({
        z: 2, a: 'ł'
    }), '{"a":"ł","z":2}');
    assert.equal(await sha256({
        a: 1, b: 2
    }), await sha256({
        b: 2, a: 1
    }));
    assert.notEqual(await sha256([1, 2]), await sha256([2, 1]));
    assert.throws(() => canonical({
        x: undefined
    }));
});
test('WAV roundtrip validates PCM16 mono, duration and structural bounds', () => {
    const samples = Float32Array.from({
        length: 480
    }, (_, i) => Math.sin(i / 8) * .2);
    const encoded = encodeWav(samples, 48000);
    const result = parseWav(encoded);
    assert.equal(result.sampleRate, 48000);
    assert.equal(result.samples.length, 480);
    assert.ok(Math.abs(result.samples[8] - samples[8]) < .00004);
    for (const [offset, value] of [[20, 3], [22, 2], [32, 4], [34, 32]]) {
        const bad = encoded.slice(0);
        new DataView(bad).setUint16(offset, value, true);
        assert.throws(() => parseWav(bad), /unsupported_audio/);
    }
    assert.throws(() => parseWav(encoded.slice(0, -1)), /unsupported_audio/);
    assert.throws(() => parseWav(new ArrayBuffer(2 * 1024 * 1024 + 1)), /unsupported_audio/);
    assert.throws(() => encodeWav(new Float32Array(480001), 48000), /unsupported_audio/);
    assert.throws(() => encodeWav(new Float32Array(0), 48000), /unsupported_audio/);
});
test('controller transfers owner only with all four matching ACK fields', () => {
    const { c } = ready();
    c.beginHandoff(input());
    c.setDigest(c.lease(), 'b'.repeat(64));
    const valid = ack(c);
    assert.equal(c.getState().state, 'awaiting_ack');
    assert.equal(c.getState().owner, null);
    for (const change of [{
            session_id: 'c'.repeat(32)
        }, {
            handoff_id: 'other'
        }, {
            epoch: 2
        }, {
            snapshot_digest: 'c'.repeat(64)
        }]) {
        assert.equal(c.acceptAck({
            ...valid, ...change
        }), 'stale');
        assert.equal(c.getState().owner, null);
    }
    assert.equal(c.acceptAck(valid), 'accepted');
    assert.equal(c.getState().owner, 'specialist');
    assert.equal(c.acceptAck(valid), 'duplicate');
});
test('deadline boundary, busy and interruption invalidate pending ACK', () => {
    for (const action of ['timeout', 'interrupt', 'close']) {
        const { c, clock } = ready();
        c.beginHandoff(input());
        c.setDigest(c.lease(), 'b'.repeat(64));
        const valid = ack(c);
        assert.throws(() => c.beginHandoff(input()), /busy/);
        if (action === 'timeout')
            clock(2000);
        else if (action === 'interrupt')
            c.interrupt('manual');
        else
            c.close();
        assert.notEqual(c.acceptAck(valid), 'accepted');
        assert.equal(c.getState().owner, null);
        assert.equal(c.getState().pending, null);
    }
    const { c, clock } = ready();
    c.beginHandoff(input());
    c.setDigest(c.lease(), 'b'.repeat(64));
    clock(1999.999);
    assert.equal(c.acceptAck(ack(c)), 'accepted');
});
test('invalid input leaves owner and history immutable; cancelled roles cannot play again', () => {
    const { c } = ready();
    const before = c.getState();
    assert.throws(() => c.beginHandoff({
        ...input(), slots: {
            bad: true
        }
    }));
    assert.deepEqual(c.getState(), before);
    const source = input();
    c.beginHandoff(source);
    source.history[0].text = 'mutated';
    assert.equal(c.getState().pending.payload.history[0].text, 'Please transfer.');
    const exposed = c.getState();
    exposed.pending.payload.slots.topic = 'billing';
    assert.equal(c.getState().pending.payload.slots.topic, 'technical');
    const second = ready().c;
    const lease = second.play('triage-tone', 2000);
    second.interrupt('manual');
    assert.throws(() => second.play('triage-tone', 2000));
    second.finished(lease);
    assert.equal(second.getState().playback, 'silent');
    second.close();
    const closed = second.getState();
    second.close();
    assert.deepEqual(second.getState(), closed);
});
test('asynchronous digest completion after interrupt never sends snapshot', async () => {
    const { c } = ready();
    let release;
    const sends = [];
    const p = new HandoffProtocol({
        controller: c, send: data => sends.push(data), hash: () => new Promise(r => {
            release = r;
        })
    });
    const pending = p.request(input());
    c.interrupt('manual');
    release('b'.repeat(64));
    assert.equal(await pending, false);
    assert.equal(sends.length, 0);
    p.dispose();
});
test('protocol validates snapshots, copies context, and receives ACK without autoplay', async () => {
    const { c } = ready();
    let sent;
    const p = new HandoffProtocol({
        controller: c, send: data => {
            sent = data;
        }
    });
    assert.equal(await p.request(input()), true);
    const reply = await p.receiveSnapshot(sent);
    assert.ok(reply);
    const received = p.getReceived();
    received.history[0].text = 'mutated';
    assert.equal(p.getReceived().history[0].text, 'Please transfer.');
    assert.equal(p.receiveAck(reply), 'accepted');
    assert.equal(c.getState().playback, 'silent');
    assert.equal(p.receiveAck(reply), 'duplicate');
    const conflict = decodeWire(sent);
    conflict.payload.slots.topic = 'billing';
    conflict.snapshot_digest = await sha256(conflict.payload);
    await assert.rejects(() => p.receiveSnapshot(encodeWire(conflict)), /invalid_input/);
    p.dispose();
});
test('interrupt message receiver is session scoped and monotonic', () => {
    const p = new HandoffProtocol({
        controller: ready().c, send: () => {
        }
    });
    const m = {
        type: 'interrupt', schema_version: 1, session_id: SESSION, epoch: 1, turn_id: 0, reason: 'manual'
    };
    assert.equal(p.receiveInterrupt(encodeWire(m)), true);
    assert.equal(p.receiveInterrupt(encodeWire(m)), false);
    assert.equal(p.receiveInterrupt(encodeWire({
        ...m, session_id: 'b'.repeat(32), epoch: 2
    })), false);
    assert.equal(p.receiveInterrupt(encodeWire({
        ...m, epoch: 2
    })), true);
    p.dispose();
});
