/** Deterministic controller trace. This does not claim browser media execution. */
import { VoiceController } from '../src/controller.js';
import { HandoffProtocol } from '../src/protocol.js';
import { pathToFileURL } from 'node:url';
export async function runDemo() {
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
        await protocol.request({
            reason: 'scripted_scenario', history: [
                {
                    id: 'user-1', role: 'user', text: 'Transfer this local example.', source: 'fixture', completion: 'complete'
                }
            ], slots: {
                topic: 'technical', reference: 'example-1'
            }
        });
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.stdout.write(JSON.stringify(await runDemo(), null, 2) + '\n');
}
