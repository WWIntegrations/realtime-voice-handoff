import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteMediaSink } from '../src/media-sink.js';
test('remote sink consumes media without a second audible output and releases its stream', async () => {
    const element = {
        volume: 1, muted: false, srcObject: null, async play() {
            this.played = true;
        }, pause() {
            this.paused = true;
        }
    };
    const stream = {};
    const sink = new RemoteMediaSink(stream, () => element);
    assert.equal(await sink.start(), true);
    assert.equal(element.volume, 0);
    assert.equal(element.muted, true);
    assert.equal(element.srcObject, stream);
    assert.equal(element.played, true);
    sink.close();
    assert.equal(element.srcObject, null);
    assert.equal(element.paused, true);
    sink.close();
});
test('media autoplay rejection becomes audio_blocked and frees the stream', async () => {
    const element = {
        play: async () => {
            throw new Error('private browser detail');
        }, pause() {
            this.paused = true;
        }
    };
    const sink = new RemoteMediaSink({}, () => element);
    await assert.rejects(() => sink.start(), /^Error: audio_blocked$/);
    assert.equal(element.srcObject, null);
    assert.equal(element.paused, true);
});
test('close during pending media play cannot reactivate a remote sink', async () => {
    let resolve;
    const element = {
        play: () => new Promise(r => {
            resolve = r;
        }), pause() {
            this.paused = true;
        }
    };
    const sink = new RemoteMediaSink({}, () => element), pending = sink.start();
    sink.close();
    resolve();
    assert.equal(await pending, false);
    assert.equal(element.srcObject, null);
    assert.equal(element.paused, true);
});
