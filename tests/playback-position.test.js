import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioTracks } from '../src/audio-tracks.js';
test('first cancel freezes the playback timeline for later handoff snapshots', () => {
    const context = {
        currentTime: 0, createMediaStreamDestination: () => ({
            stream: {
                getTracks: () => []
            }, disconnect() {
            }
        }),
        createBufferSource: () => ({
            connect() {
            }, start() {
            }, stop() {
            }, disconnect() {
            }
        })
    };
    const tracks = new AudioTracks(context);
    tracks.play('triage', {
        duration: 2
    }, {
        audioId: 'tone', turnId: 1
    });
    context.currentTime = .3;
    assert.equal(tracks.cancel('triage', 'manual').played_ms, 270);
    context.currentTime = 1.3;
    assert.equal(tracks.position('triage', 'handoff').played_ms, 270);
    assert.equal(tracks.cancel('triage', 'handoff').played_ms, 270);
});
