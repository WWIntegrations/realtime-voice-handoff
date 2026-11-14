import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../src/controller.js';
import { HandoffProtocol } from '../src/protocol.js';
const input = () => ({
    reason: 'user_requested', history: [], slots: {
        topic: null, reference: null
    }
});
// Node timers can fire up to about 1 ms before performance.now() reaches the
// same deadline. The timer clock and the deadline clock are allowed to disagree.
test('deadline timer that fires before the deadline clock still fails an unanswered handoff', async (t) => {
    t.mock.timers.enable({
        apis: ['setTimeout']
    });
    let time = 0;
    const c = new VoiceController({
        sessionId: 'a'.repeat(32), now: () => time
    });
    c.connected();
    const p = new HandoffProtocol({
        controller: c, send: () => {
        }
    });
    assert.equal(await p.request(input()), true);
    time = 1999.4;
    t.mock.timers.tick(2000);
    assert.equal(c.getState().state, 'awaiting_ack');
    time = 2000;
    t.mock.timers.tick(1);
    assert.equal(c.getState().state, 'failed');
    assert.equal(c.getState().lastError, 'timeout');
    assert.equal(c.getState().pending, null);
    p.dispose();
});
