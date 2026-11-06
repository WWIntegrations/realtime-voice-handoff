/** Closed, bounded JSON wire format. A digest checks consistency, not identity. */
export const MAX_BYTES = 16384;
export const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}(?![\s\S])/;
const SESSION = /^[0-9a-f]{32}(?![\s\S])/;
const DIGEST = /^[0-9a-f]{64}(?![\s\S])/;
export function invalid(code = 'invalid_input') {
    throw new Error(code);
}
export function integer(value, min = 0, max = 1000000) {
    if (!Number.isSafeInteger(value) || value < min || value > max)
        invalid();
}
function text(value, max = 512) {
    if (typeof value !== 'string' || [...value].length > max || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
        invalid();
}
function match(value, pattern) {
    if (typeof value !== 'string' || !pattern.test(value))
        invalid();
}
function choice(value, values) {
    if (!values.includes(value))
        invalid();
}
export function closed(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join('|') !== keys.split(' ').sort().join('|'))
        invalid();
}
function checkJson(value, depth = 0) {
    if (value === null || typeof value === 'boolean')
        return;
    if (typeof value === 'string') {
        text(value, MAX_BYTES);
        return;
    }
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value))
            invalid();
        return;
    }
    if (typeof value !== 'object' || depth >= 8)
        invalid();
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
        invalid();
    for (const key of Object.keys(value)) {
        text(key, MAX_BYTES);
        checkJson(value[key], depth + 1);
    }
    if (Array.isArray(value) && Object.keys(value).length !== value.length)
        invalid();
}
export function canonical(value) {
    checkJson(value);
    function encode(v) {
        if (Array.isArray(v))
            return '[' + v.map(encode).join(',') + ']';
        if (v && typeof v === 'object')
            return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + encode(v[k])).join(',') + '}';
        return JSON.stringify(v);
    }
    return encode(value);
}
export function encodeWire(value) {
    const bytes = new TextEncoder().encode(canonical(value));
    if (bytes.byteLength > MAX_BYTES)
        invalid();
    return bytes.buffer;
}
export function decodeWire(buffer) {
    if (!(buffer instanceof ArrayBuffer) && !(buffer instanceof Uint8Array))
        invalid();
    if (buffer.byteLength > MAX_BYTES)
        invalid();
    let s;
    try {
        s = new TextDecoder('utf-8', {
            fatal: true, ignoreBOM: true
        }).decode(buffer);
    }
    catch {
        invalid();
    }
    let at = 0;
    const ws = () => {
        while (/[\x20\t\r\n]/.test(s[at] ?? '!'))
            at++;
    };
    function string() {
        const start = at++;
        while (at < s.length) {
            if (s[at] === '\\') {
                at += 2;
                continue;
            }
            if (s[at++] === '"') {
                try {
                    return JSON.parse(s.slice(start, at));
                }
                catch {
                    invalid();
                }
            }
        }
        invalid();
    }
    function read(depth = 0) {
        ws();
        const c = s[at];
        if (c === '"')
            return string();
        if (c === '{' || c === '[') {
            if (depth >= 8)
                invalid();
            at++;
            ws();
            const object = c === '{', end = object ? '}' : ']', out = object ? {} : [], keys = new Set();
            if (s[at] === end) {
                at++;
                return out;
            }
            while (at < s.length) {
                if (object) {
                    ws();
                    if (s[at] !== '"')
                        invalid();
                    const key = string();
                    if (keys.has(key))
                        invalid();
                    keys.add(key);
                    ws();
                    if (s[at++] !== ':')
                        invalid();
                    Object.defineProperty(out, key, {
                        value: read(depth + 1), enumerable: true, writable: true, configurable: true
                    });
                }
                else
                    out.push(read(depth + 1));
                ws();
                if (s[at] === end) {
                    at++;
                    return out;
                }
                if (s[at++] !== ',')
                    invalid();
            }
            invalid();
        }
        for (const [token, value] of [['true', true], ['false', false], ['null', null]]) {
            if (s.startsWith(token, at)) {
                at += token.length;
                return value;
            }
        }
        const number = /^-?(?:0|[1-9][0-9]*)/.exec(s.slice(at));
        if (!number)
            invalid();
        at += number[0].length;
        return Number(number[0]);
    }
    const result = read();
    ws();
    if (at !== s.length)
        invalid();
    checkJson(result);
    return result;
}
export function copy(value) {
    return decodeWire(encodeWire(value));
}
export async function sha256(value) {
    const bytes = new TextEncoder().encode(canonical(value));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function newSessionId() {
    return [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function validatePayload(p) {
    closed(p, 'session_id handoff_id epoch turn_id owner from to reason history slots interrupted_audio');
    match(p.session_id, SESSION);
    match(p.handoff_id, ID);
    integer(p.epoch, 1);
    integer(p.turn_id);
    choice(p.owner, ['triage']);
    choice(p.from, ['triage']);
    choice(p.to, ['specialist']);
    choice(p.reason, ['user_requested', 'scripted_scenario']);
    if (!Array.isArray(p.history) || p.history.length > 32)
        invalid();
    const ids = new Set();
    for (const h of p.history) {
        closed(h, 'id role text source completion');
        match(h.id, ID);
        if (ids.has(h.id))
            invalid();
        ids.add(h.id);
        choice(h.role, ['user', 'triage', 'specialist']);
        text(h.text);
        choice(h.source, ['typed', 'fixture', 'recorded_annotation']);
        choice(h.completion, ['complete', 'interrupted']);
    }
    closed(p.slots, 'topic reference');
    choice(p.slots.topic, [null, 'general', 'billing', 'technical']);
    if (p.slots.reference !== null)
        match(p.slots.reference, ID);
    if (p.interrupted_audio !== null) {
        const a = p.interrupted_audio;
        closed(a, 'audio_id turn_id duration_ms played_ms reason');
        match(a.audio_id, ID);
        integer(a.turn_id);
        integer(a.duration_ms, 1, 10000);
        integer(a.played_ms, 0, a.duration_ms);
        choice(a.reason, ['manual', 'energy', 'handoff']);
    }
    checkJson(p);
}
export function validateMessage(m) {
    if (!m || typeof m !== 'object')
        invalid();
    if (m.type === 'handoff_snapshot') {
        closed(m, 'type schema_version payload snapshot_digest');
        validatePayload(m.payload);
        match(m.snapshot_digest, DIGEST);
    }
    else if (m.type === 'handoff_ack') {
        closed(m, 'type schema_version session_id handoff_id epoch snapshot_digest');
        match(m.session_id, SESSION);
        match(m.handoff_id, ID);
        integer(m.epoch, 1);
        match(m.snapshot_digest, DIGEST);
    }
    else if (m.type === 'interrupt') {
        closed(m, 'type schema_version session_id epoch turn_id reason');
        match(m.session_id, SESSION);
        integer(m.epoch, 1);
        integer(m.turn_id);
        choice(m.reason, ['manual', 'energy', 'handoff']);
    }
    else
        invalid();
    if (m.schema_version !== 1)
        invalid();
    encodeWire(m);
    return m;
}
