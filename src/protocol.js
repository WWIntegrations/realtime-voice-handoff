/** Real channel adapters call these receivers; no simulated delivery in runtime. */
import { copy, decodeWire, encodeWire, sha256, validateMessage, invalid } from './schema.js';
export class HandoffProtocol {
    constructor({ controller, send, hash = sha256, onPending = () => {
    }, onEvent = () => {
    } }) {
        this.controller = controller;
        this.send = send;
        this.hash = hash;
        this.onPending = onPending;
        this.onEvent = onEvent;
        this.received = null;
        this.receivedDigest = null;
        this.lastInterruptEpoch = 0;
        this.timer = null;
        this.disposed = false;
    }
    async request(input, interruptedAudio = null) {
        const payload = this.controller.beginHandoff(input, interruptedAudio), lease = this.controller.lease();
        this.arm(2000);
        try {
            this.onPending(copy(payload));
            const digest = await this.hash(payload);
            if (this.disposed || !this.controller.setDigest(lease, digest))
                return false;
            this.send(encodeWire({
                type: 'handoff_snapshot', schema_version: 1, payload, snapshot_digest: digest
            }));
            this.onEvent('snapshot_sent');
            return true;
        }
        catch {
            if (this.controller.matches(lease))
                this.controller.fail('transport');
            return false;
        }
    }
    /** A timer may fire before the deadline clock reaches it; re-arm until expire() settles. */
    arm(delay) {
        this.timer = setTimeout(() => {
            const left = this.controller.expire();
            if (left > 0 && !this.disposed)
                this.arm(Math.ceil(left));
        }, delay);
    }
    async receiveSnapshot(bytes) {
        const m = validateMessage(decodeWire(bytes));
        if (m.type !== 'handoff_snapshot')
            invalid();
        const s = this.controller.getState();
        if (m.payload.session_id !== s.session_id || m.payload.epoch !== s.epoch || this.disposed)
            return null;
        const duplicate = this.received?.handoff_id === m.payload.handoff_id;
        if (duplicate && this.receivedDigest !== m.snapshot_digest)
            invalid();
        if (s.state !== 'awaiting_ack' && !(duplicate && s.state === 'active_specialist'))
            return null;
        const digest = await this.hash(m.payload);
        if (digest !== m.snapshot_digest)
            invalid();
        if (this.disposed || !this.controller.matches({
            session_id: m.payload.session_id, epoch: m.payload.epoch
        }))
            return null;
        if (!duplicate && !this.controller.checkPending({
            session_id: m.payload.session_id, epoch: m.payload.epoch
        }))
            return null;
        if (this.received && this.received.handoff_id === m.payload.handoff_id && this.receivedDigest !== digest)
            invalid();
        this.received = copy(m.payload);
        this.receivedDigest = digest;
        this.onEvent('snapshot_received');
        return encodeWire({
            type: 'handoff_ack', schema_version: 1, session_id: m.payload.session_id, handoff_id: m.payload.handoff_id, epoch: m.payload.epoch, snapshot_digest: digest
        });
    }
    receiveAck(bytes) {
        const m = validateMessage(decodeWire(bytes));
        const result = this.controller.acceptAck(m);
        if (result === 'accepted')
            clearTimeout(this.timer);
        this.onEvent(`ack_${result}`);
        return result;
    }
    receiveInterrupt(bytes) {
        const m = validateMessage(decodeWire(bytes));
        if (m.type !== 'interrupt')
            invalid();
        const s = this.controller.getState();
        // The sender raises the shared epoch before sending, so a larger epoch was never issued.
        if (m.session_id !== s.session_id || m.epoch <= this.lastInterruptEpoch || m.epoch > s.epoch)
            return false;
        this.lastInterruptEpoch = m.epoch;
        this.onEvent('interrupt_received');
        return true;
    }
    getReceived() {
        return this.received ? copy(this.received) : null;
    }
    dispose() {
        this.disposed = true;
        clearTimeout(this.timer);
    }
}
