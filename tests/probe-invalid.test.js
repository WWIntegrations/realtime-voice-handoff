import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSilence } from '../src/audio-probe.js';
const windows = () => Array.from({
    length: 80
}, (_, i) => ({
    startTime: i * .02, endTime: (i + 1) * .02, rms: i < 20 ? .1 : 0, samples: 960
}));
test('nonfinite or missing timing and energy cannot become evidence of silence', () => {
    for (const remaining of [NaN, undefined, Infinity])
        assert.equal(assessSilence(windows(), .4, remaining).status, 'INVALID');
    for (const t0 of [NaN, undefined, Infinity])
        assert.equal(assessSilence(windows(), t0, 1500).status, 'INVALID');
    for (const rate of [NaN, 0, Infinity])
        assert.equal(assessSilence(windows(), .4, 1500, rate).status, 'INVALID');
    for (const value of [NaN, undefined]) {
        const rows = windows();
        rows[19].rms = value;
        assert.equal(assessSilence(rows, .4, 1500).status, 'INVALID');
    }
    const rows = windows();
    rows[25].endTime = NaN;
    assert.equal(assessSilence(rows, .4, 1500).status, 'INVALID');
});
