/** One irreversible receiver gate per role. Epochs cannot cancel RTP packets. */
import { invalid } from './schema.js';
export class AudioTracks {
    constructor(context) {
        this.context = context;
        this.roles = {};
        for (const role of ['triage', 'specialist'])
            this.roles[role] = {
                destination: context.createMediaStreamDestination(), receiver: null, sources: [], cancelled: false, active: null
            };
    }
    stream(role) {
        return this.roles[role].destination.stream;
    }
    attachReceiver(role, gate) {
        const r = this.roles[role];
        r.receiver = gate;
        gate.gain.setValueAtTime(r.cancelled ? 0 : 1, this.context.currentTime);
    }
    play(role, buffer, { audioId, turnId, onEnded = () => {
    } }) {
        const r = this.roles[role];
        if (r.cancelled || r.active)
            invalid('busy');
        const start = this.context.currentTime + .03;
        r.active = {
            audio_id: audioId, turn_id: turnId, start, stopContextTime: null, duration_ms: Math.ceil(buffer.duration * 1000)
        };
        const node = this.scheduleFragment(role, buffer, start);
        node.onended = onEnded;
        return {
            ...r.active
        };
    }
    scheduleFragment(role, buffer, start) {
        const r = this.roles[role];
        if (r.cancelled)
            invalid('stale');
        const node = this.context.createBufferSource();
        node.buffer = buffer;
        node.connect(r.destination);
        node.start(start);
        r.sources.push(node);
        return node;
    }
    position(role, reason = 'manual') {
        const a = this.roles[role].active;
        if (!a)
            return null;
        return {
            audio_id: a.audio_id, turn_id: a.turn_id, duration_ms: a.duration_ms,
            played_ms: Math.floor(Math.max(0, Math.min(a.duration_ms, ((a.stopContextTime ?? this.context.currentTime) - a.start) * 1000))), reason
        };
    }
    cancel(role, reason = 'manual') {
        const r = this.roles[role];
        if (r.active && r.active.stopContextTime === null)
            r.active.stopContextTime = this.context.currentTime;
        const position = this.position(role, reason);
        r.cancelled = true;
        if (r.receiver)
            r.receiver.gain.setValueAtTime(0, this.context.currentTime);
        for (const source of r.sources) {
            try {
                source.stop();
            }
            catch {
            }
            source.disconnect();
        }
        r.sources = [];
        return position;
    }
    describe() {
        return Object.fromEntries(Object.entries(this.roles).map(([role, r]) => [role, {
                cancelled: r.cancelled, sourceCount: r.sources.length, position: this.position(role), gate: r.receiver?.gain.value ?? null
            }]));
    }
    close() {
        for (const role of Object.keys(this.roles)) {
            this.cancel(role);
            for (const track of this.roles[role].destination.stream.getTracks())
                track.stop();
            this.roles[role].destination.disconnect();
        }
    }
}
