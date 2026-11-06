import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, createMotion, selectEvents, makePayload, scrollPose, fitTracking, renderWaveform, readBoundedWav, createOperationRunner, importSessionWav } from './controller.mjs';
test('disconnected permits connect, never playback or handoff', () => {
    const a = availableActions({
        state: 'idle'
    });
    assert.equal(a.connect, true);
    assert.equal(a.play, false);
    assert.equal(a.handoff, false);
});
test('active triage allows one play and handoff', () => {
    const a = availableActions({
        state: 'active_triage', owner: 'triage', played: {
            triage: false
        }
    });
    assert.equal(a.play, true);
    assert.equal(a.handoff, true);
});
test('played or cancelled role cannot play again', () => {
    for (const s of [{
            played: {
                triage: true
            }
        }, {
            cancelled: {
                triage: true
            }
        }])
        assert.equal(availableActions({
            state: 'active_triage', owner: 'triage', ...s
        }).play, false);
});
test('pending ACK cannot play or submit twice', () => {
    const a = availableActions({
        state: 'awaiting_ack', owner: 'triage'
    });
    assert.equal(a.play, false);
    assert.equal(a.handoff, false);
    assert.equal(a.interrupt, true);
});
test('specialist play requires actual specialist owner', () => {
    assert.equal(availableActions({
        state: 'active_specialist', owner: 'triage'
    }).play, false);
    assert.equal(availableActions({
        state: 'active_specialist', owner: 'specialist'
    }).play, true);
});
test('closed permits new session', () => assert.equal(availableActions({
    state: 'closed'
}).connect, true));
test('motion pause preserves current phase and resumes without jump', () => {
    const m = createMotion(false);
    m.tick(500);
    m.pause(true);
    m.tick(2000);
    assert.equal(m.time, 500);
    m.pause(false);
    m.tick(2100);
    assert.equal(m.time, 600);
});
test('reduced motion is unchanged by deterministic frame', () => {
    const m = createMotion(true);
    m.frame(0);
    const a = m.time;
    m.frame(8000);
    assert.equal(m.time, a);
    assert.equal(m.paused, true);
});
test('event selection filters actual events without fabricating records', () => {
    const e = [{
            sequence: 1, type: 'state'
        }, {
            sequence: 2, type: 'audio_started'
        }, {
            sequence: 3, type: 'ack_accepted'
        }];
    assert.deepEqual(selectEvents(e, 'audio', 5), [e[1]]);
    assert.deepEqual(selectEvents(e, 'all', 2), e.slice(-2));
    assert.deepEqual(selectEvents([], 'all', 2), []);
});
test('typed history retains provenance and excludes blank entry', () => {
    assert.deepEqual(makePayload('  ', 'general', '').history, []);
    const p = makePayload('Hello', 'billing', 'INV-1');
    assert.equal(p.history[0].source, 'typed');
    assert.equal(p.history[0].completion, 'complete');
    assert.equal(p.slots.reference, 'INV-1');
});
test('scroll motion preserves measured settled anchor positions', () => {
    assert.deepEqual(scrollPose(800, false), {
        x: 527.257, y: 0, scale: 1
    });
    assert.deepEqual(scrollPose(271, true), {
        x: -10.042, y: 154.618, scale: 1.031382
    });
    assert.deepEqual(scrollPose(0, true), {
        x: 0, y: 0, scale: 1
    });
});
test('headline fitting changes tracking without scaling glyph weight', () => {
    assert.equal(fitTracking(1500, 1390, 11), -10);
    assert.equal(fitTracking(1200, 1390, 0), 0);
});
test('missing canvas returns actual PCM text instead of throwing out of the UI update', () => {
    const probe = {
        fresh: true, rms: .125, waveform: [.1, -.1]
    };
    assert.equal(renderWaveform(null, probe, 2), 'Canvas unavailable. Actual mix RMS 0.1250.');
    assert.deepEqual(probe, {
        fresh: true, rms: .125, waveform: [.1, -.1]
    });
    assert.equal(renderWaveform(null, null, 2), 'Canvas unavailable. No fresh PCM samples.');
});
test('oversized WAV is rejected before arrayBuffer can read the file', async () => {
    class ReadGuard extends Blob {
        arrayBuffer() {
            throw new Error('read_should_not_run');
        }
    }
    const file = new ReadGuard([new Uint8Array(2 * 1024 * 1024 + 1)]);
    await assert.rejects(readBoundedWav(file), {
        message: 'wav_too_large: maximum 2 MiB'
    });
});
test('exactly 2 MiB is read without truncation at the WAV size boundary', async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024);
    bytes[bytes.length - 1] = 123;
    const buffer = await readBoundedWav(new Blob([bytes]));
    assert.equal(buffer.byteLength, bytes.length);
    assert.equal(new Uint8Array(buffer).at(-1), 123);
});
for (const rejectOld of [false, true]) {
    test(`old WAV ${rejectOld ? 'rejection' : 'completion'} cannot clear busy or overwrite a newer operation`, async () => {
        const ui = {
            busy: false, notice: 'idle', source: null
        };
        const run = createOperationRunner({
            onStart: () => {
                ui.busy = true;
            },
            onError: error => {
                ui.notice = error.message;
            },
            onFinish: () => {
                ui.busy = false;
            }
        });
        let resolveOld, rejectPrevious, resolveNew;
        const oldFile = {
            size: 8, arrayBuffer: () => new Promise((resolve, reject) => {
                resolveOld = resolve;
                rejectPrevious = reject;
            })
        };
        const newFile = {
            size: 8, arrayBuffer: () => new Promise(resolve => {
                resolveNew = resolve;
            })
        };
        let generation = 1;
        const imported = [];
        let lab = {
            importWav: bytes => {
                imported.push(['old', bytes]);
                return 'old-source';
            }
        };
        const startImport = file => run(async (current) => {
            const own = lab, stamp = generation;
            const valid = () => current() && own === lab && stamp === generation;
            const audioId = await importSessionWav(file, own, valid);
            if (!valid())
                return;
            ui.source = audioId;
            ui.notice = audioId;
        });
        const oldTask = startImport(oldFile);
        await run(() => {
            generation++;
            ui.notice = 'closed';
        });
        await run(() => {
            generation++;
            lab = {
                importWav: bytes => {
                    imported.push(['new', bytes]);
                    return 'new-source';
                }
            };
            ui.notice = 'connected';
        });
        const newTask = startImport(newFile);
        if (rejectOld)
            rejectPrevious(new Error('old read failed'));
        else
            resolveOld(new ArrayBuffer(8));
        await oldTask;
        assert.deepEqual(ui, {
            busy: true, notice: 'connected', source: null
        });
        assert.deepEqual(imported, []);
        resolveNew(new ArrayBuffer(8));
        await newTask;
        assert.deepEqual(ui, {
            busy: false, notice: 'new-source', source: 'new-source'
        });
        assert.equal(imported.length, 1);
        assert.equal(imported[0][0], 'new');
    });
}
