import test from 'node:test';
import assert from 'node:assert/strict';
import { RtcPair, summarizeStats } from '../src/rtc.js';
test('selected ICE pair evidence uses transport reference, not an arbitrary succeeded pair', () => {
    const stats = new Map([
        ['transport', {
                type: 'transport', selectedCandidatePairId: 'pair'
            }],
        ['other', {
                id: 'other', type: 'candidate-pair', state: 'succeeded', nominated: true
            }],
        ['pair', {
                id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'local', remoteCandidateId: 'remote'
            }],
        ['local', {
                type: 'local-candidate', candidateType: 'host', protocol: 'udp', address: 'do-not-export'
            }],
        ['remote', {
                type: 'remote-candidate', candidateType: 'host'
            }],
        ['in', {
                type: 'inbound-rtp', kind: 'audio', bytesReceived: 100, packetsReceived: 8, totalAudioEnergy: .2
            }]
    ]);
    const summary = summarizeStats(stats);
    assert.equal(summary.selectedPair.id, 'pair');
    assert.equal(summary.selectedPair.localType, 'host');
    assert.equal(summary.inbound.packetsReceived, 8);
    assert.ok(!JSON.stringify(summary).includes('do-not-export'));
    stats.delete('transport');
    assert.equal(summarizeStats(stats).selectedPair, null);
});
test('RTC pair uses four real browser operations and closes both endpoints on failure', async () => {
    const peers = [];
    class FakePeer extends EventTarget {
        constructor(config) {
            super();
            this.config = config;
            this.connectionState = 'new';
            this.localDescription = null;
            this.candidates = [];
            this.transceivers = [];
            peers.push(this);
        }
        addTransceiver(kind, options) {
            this.transceivers.push([kind, options]);
        }
        createDataChannel(label, options) {
            this.channel = new EventTarget();
            Object.assign(this.channel, {
                label, options, readyState: 'connecting', close() {
                    this.readyState = 'closed';
                }
            });
            return this.channel;
        }
        addTrack() {
            this.added = true;
        }
        async createOffer() {
            return {
                type: 'offer', sdp: 'synthetic-test-only'
            };
        }
        async createAnswer() {
            return {
                type: 'answer', sdp: 'synthetic-test-only'
            };
        }
        async setLocalDescription(v) {
            this.localDescription = v;
        }
        async setRemoteDescription(v) {
            this.remoteDescription = v;
        }
        async addIceCandidate(v) {
            this.candidates.push(v);
        }
        close() {
            this.connectionState = 'closed';
        }
    }
    const pair = new RtcPair({
        name: 'T', stream: {
            getTracks: () => [{}]
        }, Peer: FakePeer, onTrack: () => {
        }, onCallerMessage: () => {
        }, onRemoteMessage: () => {
        }
    });
    await assert.rejects(() => pair.connect(20), /timeout/);
    assert.equal(peers.length, 2);
    assert.deepEqual(peers[0].config, {
        iceServers: []
    });
    assert.equal(peers[0].channel.options.ordered, true);
    assert.ok(peers[1].added);
    assert.equal(peers[0].localDescription.type, 'offer');
    assert.equal(peers[1].remoteDescription.type, 'offer');
    assert.deepEqual(peers[0].transceivers, [['audio', {
                direction: 'recvonly'
            }]]);
    assert.ok(peers.every(p => p.connectionState === 'closed'));
});
