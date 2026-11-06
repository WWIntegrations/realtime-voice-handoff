import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceLab } from '../src/runtime.js';
test('runtime creates fresh sessions and returns immutable state copies', async () => {
    const a = createVoiceLab(), b = createVoiceLab();
    assert.notEqual(a.getState().session_id, b.getState().session_id);
    const state = a.getState();
    state.epoch = 40;
    assert.equal(a.getState().epoch, 0);
    await a.close();
    await b.close();
    assert.equal(a.getState().state, 'closed');
    await assert.rejects(() => a.connect(), /closed/);
});
test('volume is bounded and no audio is claimed without an AudioContext', async () => {
    const lab = createVoiceLab();
    for (const value of [-1, 1.01, NaN, true, '0.5'])
        assert.throws(() => lab.setVolume(value), /invalid_input/);
    lab.setVolume(.4);
    const metrics = await lab.getMetrics();
    assert.equal(metrics.masterVolume, .4);
    assert.equal(metrics.contextTime, null);
    assert.equal(metrics.probes.mix.fresh, false);
    assert.throws(() => lab.play('triage-tone'), /busy/);
    await lab.close();
});
