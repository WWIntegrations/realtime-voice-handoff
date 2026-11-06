import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSilence } from '../src/audio-probe.js';
test('missing early post-interrupt PCM cannot claim the 100ms silence bound', () => {
    const windows = Array.from({
        length: 80
    }, (_, i) => ({
        startTime: i * .02, endTime: (i + 1) * .02, rms: i < 20 ? .1 : 0, samples: 960
    }));
    const gap = windows.filter(w => w.startTime < .5 || w.startTime >= .9);
    assert.equal(assessSilence(gap, .4, 1500).status, 'INVALID');
    assert.equal(assessSilence(windows.map(w => ({
        ...w, samples: 128
    })), .4, 1500).status, 'INVALID');
});
