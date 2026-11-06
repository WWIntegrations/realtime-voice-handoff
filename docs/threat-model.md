# Threat model

## Scope

The assets are ownership of the local conversation, integrity of the handoff
snapshot, cancellation of obsolete audio, and honest measurement evidence.
All four WebRTC endpoints and their code run in one trusted browser page.
The project does not isolate mutually hostile participants.

| Boundary | Check |
| --- | --- |
| Malformed or oversized message | Closed schemas, strict UTF-8/JSON, byte/depth/count limits |
| Changed or unrelated ACK | Exact session, handoff, epoch, digest and deadline checks |
| Late async callback | Original session/epoch lease must still be active |
| Duplicate handoff | Same snapshot is idempotent; conflicting digest is rejected |
| Delayed old audio packet | Old receiver gate remains muted until close |
| Scheduled stale source | Cancellation stops active and queued sources |
| UI subscriber exception | Runtime catches subscriber errors after control effects |
| Silent or incomplete test input | Audio preconditions produce INVALID, not false PASS |
| Broken cancellation | Deliberate negative implementation must fail measured silence |
| Microphone capture | Explicit permission, memory-only buffers, sample cap and cleanup |

SHA256 is not a signature. A script that can inspect this page can read state
and create a matching ACK. Session IDs prevent accidental cross-session
mixing; they do not authenticate a user or tenant. WebRTC's encrypted transport
does not turn colocated endpoint code into independent security principals.

Epochs affect application logic, not RTP packets already sent. Audio silence
depends on the irreversible receiver gate as well as source cancellation.
The measured graph ends at the browser audio destination; it cannot prove
speaker volume, physical silence, hearing, or microphone hardware quality.

The application has no network STT, LLM, TTS, cloud provider, hidden transcript
generation, or automatic fallback. Calibration tones are synthetic, and any
displayed conversation text is explicitly typed, fixture, or an annotation of
a local recording. A recorded clip is playback, not an agent's generated reply.

Imported WAV files are restricted to bounded PCM16 mono RIFF/WAVE. They are not
executed. Browser permission and autoplay failures remain visible limitations.
Microphone recordings and local files are held in memory, with no automatic
save or upload. Use non-sensitive audio; the page and browser process can read
that memory. This is a local portfolio lab, not a production privacy boundary.
