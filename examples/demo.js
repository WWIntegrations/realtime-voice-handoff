/** Deterministic controller trace. This does not claim browser media execution. */
import { VoiceController } from '../src/controller.js';
import { HandoffProtocol } from '../src/protocol.js';
import { pathToFileURL } from 'node:url';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
export const DEFAULT_REQUEST = {
    reason: 'scripted_scenario', history: [
        {
            id: 'user-1', role: 'user', text: 'Transfer this local example.', source: 'fixture', completion: 'complete'
        }
    ], slots: {
        topic: 'technical', reference: 'example-1'
    }
};
export async function runDemo(request = DEFAULT_REQUEST) {
    let now = 0;
    let wire;
    const controller = new VoiceController({
        sessionId: '1234567890abcdef1234567890abcdef', now: () => now
    });
    const protocol = new HandoffProtocol({
        controller, send: bytes => {
            wire = bytes;
        }
    });
    const steps = [];
    const save = id => steps.push({
        id, state: controller.getState()
    });
    try {
        controller.connected();
        save('connected-controller');
        controller.play('triage-tone', 2000);
        save('play-requested');
        now = 350;
        controller.interrupt('manual');
        save('interrupted-controller');
        await protocol.request(request);
        save('snapshot-encoded');
        const reply = await protocol.receiveSnapshot(wire);
        save('snapshot-validated');
        protocol.receiveAck(reply);
        save('ack-accepted');
        controller.play('specialist-tone', 2000);
        save('specialist-play-requested');
        controller.close();
        save('closed');
        return {
            schema_version: 1, evidence_scope: 'deterministic controller and encoded protocol only',
            transport: 'in_memory_test', audio_executed: false, steps
        };
    }
    finally {
        protocol.dispose();
    }
}
export function safe(value) {
    // Escape control and format characters (ESC, CR, LF, bidi) before printing input data.
    return Array.from(String(value), ch => {
        if (!/\p{C}/u.test(ch))
            return ch;
        const code = ch.codePointAt(0);
        return code < 0x100 ? '\\x' + code.toString(16).padStart(2, '0')
            : code < 0x10000 ? '\\u' + code.toString(16).padStart(4, '0')
                : '\\U' + code.toString(16).padStart(8, '0');
    }).join('');
}
export function summarize(trace) {
    const by = Object.fromEntries(trace.steps.map(step => [step.id, step.state]));
    const checks = [
        ['triage audio interrupted and its path cancelled', by['interrupted-controller'].cancelled.triage && by['interrupted-controller'].playback === 'silent'],
        ['specialist blocked until the ACK matched', by['snapshot-validated'].played.specialist === false && by['snapshot-validated'].state === 'awaiting_ack'],
        ['matching ACK accepted, specialist became the owner', by['ack-accepted'].state === 'active_specialist' && by['ack-accepted'].owner === 'specialist'],
        ['specialist played after the ACK', by['specialist-play-requested'].played.specialist === true],
        ['session closed with both paths cancelled', by.closed.state === 'closed' && by.closed.cancelled.triage && by.closed.cancelled.specialist]
    ];
    const pending = by['snapshot-encoded'].pending;
    const passed = checks.every(check => check[1]);
    const lines = [`realtime-voice-handoff controller demo: ${passed ? 'PASS' : 'FAIL'} (${checks.filter(check => check[1]).length} of ${checks.length} checks)`];
    for (const [name, ok] of checks)
        lines.push(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
    lines.push(`handoff ${safe(pending.handoff_id)}: reason ${safe(pending.payload.reason)}, ${pending.payload.history.length} message(s), topic ${safe(pending.payload.slots.topic)}, digest ${safe(pending.snapshot_digest.slice(0, 16))}...`);
    lines.push(`scope: ${safe(trace.evidence_scope)}; no audio was executed (use the browser lab for that)`);
    lines.push('Full trace: node examples/demo.js --json');
    return { passed, text: lines.join('\n') };
}
export const INPUT_LIMIT = 64 * 1024;
class InputError extends Error {
}
/** Read --input without following it into a FIFO, device or unbounded file. */
export function readInput(path) {
    // O_NONBLOCK keeps the open of a FIFO from waiting for a writer.
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    try {
        const info = fstatSync(fd);
        if (!info.isFile())
            throw new InputError('cannot read --input: not a regular file');
        if (info.size > INPUT_LIMIT)
            throw new InputError('cannot read --input: file is larger than 64 KiB');
        const buffer = Buffer.alloc(INPUT_LIMIT + 1);
        let length = 0, count;
        while (length < buffer.length && (count = readSync(fd, buffer, length, buffer.length - length, null)) > 0)
            length += count;
        if (length > INPUT_LIMIT)
            throw new InputError('cannot read --input: file is larger than 64 KiB');
        return buffer.toString('utf8', 0, length);
    }
    finally {
        closeSync(fd);
    }
}
function usage() {
    return 'usage: node examples/demo.js [--input handoff.json] [--json]';
}
export function parseArgs(argv) {
    const options = { json: false, input: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--json')
            options.json = true;
        else if (argv[i] === '--input' && i + 1 < argv.length)
            options.input = argv[++i];
        else
            throw new Error(usage());
    }
    return options;
}
export async function main(argv, write = text => process.stdout.write(text)) {
    let options, request = DEFAULT_REQUEST;
    try {
        options = parseArgs(argv);
        if (options.input !== null)
            request = JSON.parse(readInput(options.input));
    }
    catch (error) {
        const message = error instanceof InputError || error.message.startsWith('usage') ? error.message
            : 'cannot read --input: expected a JSON file with reason, history and slots';
        process.stderr.write(`${message}\n`);
        return 2;
    }
    let trace;
    try {
        trace = await runDemo(request);
    }
    catch {
        process.stderr.write('handoff request rejected: check reason (user_requested or scripted_scenario), history (at most 32 messages with id, role, text, source, completion) and slots (topic, reference)\n');
        return 2;
    }
    if (options.json) {
        write(JSON.stringify(trace, null, 2) + '\n');
        return 0;
    }
    const { passed, text } = summarize(trace);
    write(text + '\n');
    return passed ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main(process.argv.slice(2));
}
