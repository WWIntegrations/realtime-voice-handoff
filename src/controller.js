/** State transitions and leases, independent of browser audio and timers. */
import { copy, encodeWire, ID, integer, invalid, newSessionId, validateMessage, validatePayload } from './schema.js';
export class VoiceController {
    constructor({ sessionId = newSessionId(), now = () => performance.now(), onChange = () => {
    } } = {}) {
        if (typeof sessionId !== 'string' || !/^[0-9a-f]{32}(?![\s\S])/.test(sessionId))
            invalid();
        this.now = now;
        this.onChange = onChange;
        this.accepted = null;
        this.value = {
            state: 'connecting', owner: null, session_id: sessionId, epoch: 0, turn_id: 0, pending: null,
            playback: 'silent', lastError: null, played: {
                triage: false, specialist: false
            }, cancelled: {
                triage: false, specialist: false
            }
        };
    }
    getState() {
        return structuredClone(this.value);
    }
    emit() {
        this.onChange(this.getState());
    }
    lease() {
        const s = this.value;
        return {
            session_id: s.session_id, epoch: s.epoch, owner: s.owner, turn_id: s.turn_id
        };
    }
    matches(lease) {
        return lease.session_id === this.value.session_id && lease.epoch === this.value.epoch;
    }
    connected() {
        if (this.value.state !== 'connecting')
            return false;
        Object.assign(this.value, {
            state: 'active_triage', owner: 'triage'
        });
        this.emit();
        return true;
    }
    play(audioId, durationMs) {
        const s = this.value;
        if (typeof audioId !== 'string' || !ID.test(audioId))
            invalid();
        integer(durationMs, 1, 10000);
        if (!s.owner || s.played[s.owner] || s.cancelled[s.owner])
            invalid(s.state === 'closed' ? 'closed' : 'busy');
        s.played[s.owner] = true;
        s.turn_id++;
        s.playback = 'speaking';
        this.emit();
        return this.lease();
    }
    finished(lease) {
        if (!this.matches(lease) || lease.turn_id !== this.value.turn_id || lease.owner !== this.value.owner)
            return false;
        this.value.playback = 'silent';
        this.emit();
        return true;
    }
    beginHandoff(input, interruptedAudio = null) {
        const s = this.value;
        if (s.state !== 'active_triage')
            invalid(s.state === 'closed' ? 'closed' : 'busy');
        if (!input || Object.keys(input).sort().join('|') !== 'history|reason|slots')
            invalid();
        const payload = {
            session_id: s.session_id, handoff_id: `handoff-${s.epoch + 1}`, epoch: s.epoch + 1, turn_id: s.turn_id,
            owner: 'triage', from: 'triage', to: 'specialist', reason: input.reason, history: input.history, slots: input.slots, interrupted_audio: interruptedAudio
        };
        validatePayload(payload);
        encodeWire({
            type: 'handoff_snapshot', schema_version: 1, payload, snapshot_digest: '0'.repeat(64)
        });
        const saved = copy(payload);
        s.epoch++;
        s.cancelled.triage = true;
        s.owner = null;
        s.playback = 'silent';
        s.state = 'awaiting_ack';
        s.pending = {
            session_id: s.session_id, handoff_id: saved.handoff_id, epoch: s.epoch, snapshot_digest: null, deadline: this.now() + 2000, payload: saved
        };
        this.emit();
        return copy(saved);
    }
    checkPending(lease) {
        if (!this.matches(lease) || this.value.state !== 'awaiting_ack')
            return false;
        if (this.now() >= this.value.pending.deadline) {
            this.fail('timeout');
            return false;
        }
        return true;
    }
    setDigest(lease, digest) {
        if (typeof digest !== 'string' || !/^[0-9a-f]{64}(?![\s\S])/.test(digest))
            invalid();
        if (!this.checkPending(lease))
            return false;
        this.value.pending.snapshot_digest = digest;
        this.emit();
        return true;
    }
    acceptAck(message) {
        validateMessage(message);
        if (message.type !== 'handoff_ack')
            invalid();
        const s = this.value;
        const fields = ['session_id', 'handoff_id', 'epoch', 'snapshot_digest'];
        if (this.accepted && fields.every(k => message[k] === this.accepted[k]))
            return 'duplicate';
        if (!s.pending || !fields.every(k => message[k] === s.pending[k]))
            return 'stale';
        if (!this.checkPending({
            session_id: message.session_id, epoch: message.epoch
        }))
            return 'stale';
        this.accepted = copy(message);
        s.pending = null;
        s.owner = 'specialist';
        s.state = 'active_specialist';
        this.emit();
        return 'accepted';
    }
    interrupt(reason = 'manual') {
        if (!['manual', 'energy', 'handoff'].includes(reason))
            invalid();
        const s = this.value;
        if (['closed', 'failed'].includes(s.state))
            return false;
        if (s.state === 'awaiting_ack' || s.state === 'connecting') {
            this.fail('stale');
            return true;
        }
        s.epoch++;
        s.playback = 'silent';
        s.cancelled[s.owner] = true;
        this.emit();
        return true;
    }
    /** Returns the milliseconds still left, or 0 once nothing is pending. */
    expire() {
        if (!this.value.pending)
            return 0;
        const left = this.value.pending.deadline - this.now();
        if (left > 0)
            return left;
        this.fail('timeout');
        return 0;
    }
    fail(code = 'transport') {
        if (['closed', 'failed'].includes(this.value.state))
            return;
        Object.assign(this.value, {
            state: 'failed', owner: null, pending: null, playback: 'silent', lastError: code, epoch: this.value.epoch + 1, cancelled: {
                triage: true, specialist: true
            }
        });
        this.emit();
    }
    close() {
        if (this.value.state === 'closed')
            return;
        Object.assign(this.value, {
            state: 'closed', owner: null, pending: null, playback: 'silent', epoch: this.value.epoch + 1, cancelled: {
                triage: true, specialist: true
            }
        });
        this.emit();
    }
}
