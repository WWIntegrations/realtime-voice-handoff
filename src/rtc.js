/** A real local RTCPeerConnection pair. No external ICE services. */
export function summarizeStats(stats) {
    let transport = null, inbound = {
        bytesReceived: 0, packetsReceived: 0, totalAudioEnergy: 0
    };
    for (const report of stats.values()) {
        if (report.type === 'transport' && report.selectedCandidatePairId)
            transport = report;
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            inbound.bytesReceived += report.bytesReceived || 0;
            inbound.packetsReceived += report.packetsReceived || 0;
            inbound.totalAudioEnergy += report.totalAudioEnergy || 0;
        }
    }
    const pair = transport ? stats.get(transport.selectedCandidatePairId) : null;
    const local = pair ? stats.get(pair.localCandidateId) : null, remote = pair ? stats.get(pair.remoteCandidateId) : null;
    const selectedPair = pair ? {
        id: pair.id, state: pair.state, nominated: pair.nominated ?? null,
        localType: local?.candidateType ?? null, remoteType: remote?.candidateType ?? null, protocol: local?.protocol ?? null,
        localCandidateId: pair.localCandidateId, remoteCandidateId: pair.remoteCandidateId
    } : null;
    return {
        selectedPair, inbound
    };
}
export class RtcPair {
    constructor({ name, stream, Peer = globalThis.RTCPeerConnection, onTrack, onCallerMessage, onRemoteMessage, onFailure = () => {
    } }) {
        this.name = name;
        this.closed = false;
        this.trackReady = false;
        this.onFailure = onFailure;
        this.caller = new Peer({
            iceServers: []
        });
        this.remote = new Peer({
            iceServers: []
        });
        this.caller.addTransceiver('audio', {
            direction: 'recvonly'
        });
        this.callerChannel = this.caller.createDataChannel(name === 'T' ? 'control-triage-v1' : 'control-specialist-v1', {
            ordered: true
        });
        this.remoteChannel = null;
        const install = (channel, handler) => {
            channel.binaryType = 'arraybuffer';
            channel.onopen = () => this.checkReady();
            channel.onmessage = event => {
                Promise.resolve().then(() => handler(event.data)).catch(() => {
                    if (!this.closed)
                        this.onFailure();
                });
            };
            channel.onerror = () => {
                if (!this.closed)
                    this.onFailure();
            };
            channel.onclose = () => {
                if (!this.closed)
                    this.onFailure();
            };
        };
        install(this.callerChannel, onCallerMessage);
        this.remote.ondatachannel = event => {
            this.remoteChannel = event.channel;
            install(event.channel, onRemoteMessage);
            this.checkReady();
        };
        this.caller.ontrack = event => {
            Promise.resolve().then(() => onTrack(event.track, event.streams[0] || new MediaStream([event.track])))
                .then(() => {
                if (!this.closed) {
                    this.trackReady = true;
                    this.checkReady();
                }
            })
                .catch(error => {
                if (!this.closed)
                    this.onFailure(error.message === 'audio_blocked' ? 'audio_blocked' : 'transport');
            });
        };
        this.queues = new Map([[this.caller, []], [this.remote, []]]);
        for (const [source, target] of [[this.caller, this.remote], [this.remote, this.caller]]) {
            source.onicecandidate = event => {
                if (!event.candidate || this.closed)
                    return;
                if (target.remoteDescription)
                    target.addIceCandidate(event.candidate).catch(() => {
                        if (!this.closed)
                            this.onFailure();
                    });
                else
                    this.queues.get(target).push(event.candidate);
            };
            source.onconnectionstatechange = () => {
                this.checkReady();
                if (!this.closed && ['failed', 'disconnected'].includes(source.connectionState))
                    this.onFailure();
            };
        }
        for (const track of stream.getTracks())
            this.remote.addTrack(track, stream);
    }
    checkReady() {
        if (!this.closed && this.trackReady && this.caller.connectionState === 'connected' && this.remote.connectionState === 'connected' && this.callerChannel.readyState === 'open' && this.remoteChannel?.readyState === 'open')
            this.resolveReady?.();
    }
    async connect(timeoutMs = 5000) {
        let timer;
        const ready = new Promise((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
            timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        });
        const negotiate = async () => {
            await this.caller.setLocalDescription(await this.caller.createOffer());
            await this.remote.setRemoteDescription(this.caller.localDescription);
            await this.flush(this.remote);
            await this.remote.setLocalDescription(await this.remote.createAnswer());
            await this.caller.setRemoteDescription(this.remote.localDescription);
            await this.flush(this.caller);
            this.checkReady();
            return ready;
        };
        try {
            await Promise.race([ready, negotiate()]);
        }
        catch (error) {
            this.close();
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async flush(peer) {
        for (const candidate of this.queues.get(peer).splice(0))
            await peer.addIceCandidate(candidate);
    }
    send(bytes) {
        if (this.closed || this.callerChannel.readyState !== 'open')
            throw new Error('transport');
        this.callerChannel.send(bytes);
    }
    reply(bytes) {
        if (this.closed || this.remoteChannel?.readyState !== 'open')
            throw new Error('transport');
        this.remoteChannel.send(bytes);
    }
    async metrics() {
        return {
            connectionState: this.caller.connectionState, channelState: this.callerChannel.readyState, ...summarizeStats(await this.caller.getStats())
        };
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.rejectReady?.(new Error('closed'));
        this.callerChannel.close();
        this.remoteChannel?.close();
        this.caller.close();
        this.remote.close();
    }
}
