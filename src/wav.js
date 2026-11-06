/** Bounded PCM16 mono WAV import/export. No browser decoder or network needed. */
import { invalid } from './schema.js';
const fail = () => invalid('unsupported_audio');
export function parseWav(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 44 || buffer.byteLength > 2097152)
        fail();
    const view = new DataView(buffer);
    const tag = i => String.fromCharCode(...new Uint8Array(buffer, i, 4));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== buffer.byteLength)
        fail();
    let at = 12, format = null, data = null;
    while (at < buffer.byteLength) {
        if (at + 8 > buffer.byteLength)
            fail();
        const name = tag(at), size = view.getUint32(at + 4, true);
        at += 8;
        if (at + size > buffer.byteLength)
            fail();
        if (name === 'fmt ') {
            if (format || size !== 16)
                fail();
            const rate = view.getUint32(at + 4, true);
            if (view.getUint16(at, true) !== 1 || view.getUint16(at + 2, true) !== 1 || rate < 8000 || rate > 48000 ||
                view.getUint32(at + 8, true) !== rate * 2 || view.getUint16(at + 12, true) !== 2 || view.getUint16(at + 14, true) !== 16)
                fail();
            format = {
                sampleRate: rate
            };
        }
        else if (name === 'data') {
            if (data)
                fail();
            data = {
                at, size
            };
        }
        at += size + (size % 2);
        if (at > buffer.byteLength)
            fail();
    }
    if (!format || !data || !data.size || data.size % 2)
        fail();
    const count = data.size / 2;
    if (count > 480000 || count > format.sampleRate * 10)
        fail();
    const samples = new Float32Array(count);
    for (let i = 0; i < count; i++)
        samples[i] = view.getInt16(data.at + i * 2, true) / 32768;
    return {
        ...format, samples, durationMs: Math.ceil(count / format.sampleRate * 1000)
    };
}
export function encodeWav(samples, sampleRate = 48000) {
    if (!(samples instanceof Float32Array) || !samples.length || samples.length > 480000 || !Number.isInteger(sampleRate) ||
        sampleRate < 8000 || sampleRate > 48000 || samples.length > sampleRate * 10)
        fail();
    const buffer = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buffer);
    const write = (at, s) => {
        for (let i = 0; i < s.length; i++)
            v.setUint8(at + i, s.charCodeAt(i));
    };
    write(0, 'RIFF');
    v.setUint32(4, buffer.byteLength - 8, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    write(36, 'data');
    v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        if (!Number.isFinite(samples[i]))
            fail();
        v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), true);
    }
    return buffer;
}
