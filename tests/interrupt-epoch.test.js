import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWire } from '../src/schema.js';
import { VoiceController } from '../src/controller.js';
import { HandoffProtocol } from '../src/protocol.js';
const SESSION = 'a'.repeat(32);
test('interrupt from an epoch the session never reached is rejected and cannot mask later interrupts', () => {
    const c = new VoiceController({
        sessionId: SESSION
    });
    c.connected();
    const p = new HandoffProtocol({
        controller: c, send: () => {
        }
    });
    const m = {
        type: 'interrupt', schema_version: 1, session_id: SESSION, epoch: 1000000, turn_id: 0, reason: 'manual'
    };
    assert.equal(p.receiveInterrupt(encodeWire(m)), false);
    c.interrupt('manual');
    assert.equal(c.getState().epoch, 1);
    assert.equal(p.receiveInterrupt(encodeWire({
        ...m, epoch: 1
    })), true);
    p.dispose();
});
