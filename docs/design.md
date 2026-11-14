# Design and protocol

## Components

`schema.js` implements a bounded JSON parser and closed wire schemas.
`controller.js` owns state transitions and leases. `protocol.js` bridges
encoded messages to those transitions. `rtc.js` negotiates two actual local
WebRTC pairs. `audio-tracks.js` owns sources and irreversible receiver gates;
`audio-probe.js` supplies the pass-through measurement/recording worklet.
`runtime.js` joins those components and isolates UI subscribers from control
effects. `wav.js` handles bounded PCM16 input without a codec dependency.

The ordinary entry point is `createVoiceLab`. `createLabRuntime` also exposes
diagnostics and dependency injection for integration tests. The negative
audio implementation lives only in `tests/browser-harness.js` and is not
selected by normal UI.

## State and acknowledgements

The states are connecting, active_triage, awaiting_ack, active_specialist,
failed, and closed. Only active states have an owner. Playback is speaking or
silent independently of ownership. Each role gets at most one playback.
An interruption cancels its path permanently; reconnect creates a new random
32-character hex session ID and new peers.

Handoff input is validated and copied before changing state. Beginning a
handoff cancels triage, increments epoch, clears owner, freezes a snapshot,
and starts a two-second deadline. The deadline includes SHA256 work and send.
Every asynchronous completion checks its original session/epoch lease.
An ACK at or after the deadline is stale even if the timer callback was delayed.

The caller sends `handoff_snapshot` over control-specialist-v1. The specialist
validates it, recomputes its digest, stores a copy, and sends `handoff_ack`.
The caller accepts only the matching session_id, handoff_id, epoch, and digest.
An accepted ACK changes owner without autoplay. Duplicate ACKs are no-ops;
foreign/stale ACKs do not change state. A repeated handoff ID with conflicting
content is invalid. An interruption while awaiting ACK fails the transaction.

control-triage-v1 carries interrupt messages. The local sender and receiver
are cancelled before waiting for delivery; the message is not the mechanism
that guarantees immediate silence. Its receiver checks session and an increasing
epoch that the session has already reached; an epoch from the future is
ignored. Both data channels are ordered and reliable.

## Closed wire schemas

All messages are binary UTF-8 JSON, at most 16384 bytes including their
envelope, with at most eight container levels. Duplicate keys, malformed
UTF-8/JSON, lone surrogates, extra fields, nonfinite values, and unsafe integers
are rejected. Numeric wire tokens must be lexical integers, without decimal
points or exponents; this avoids rounding a fractional token into an integer.

Identifiers match `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}` exactly. Sessions are 32
lowercase hex characters; digests are 64. Counts are integers in 0..1000000.
Schema version is 1. String lengths count Unicode code points; the overall
byte limit always applies.

| Message | Exact fields |
| --- | --- |
| handoff_snapshot | type, schema_version, payload, snapshot_digest |
| handoff_ack | type, schema_version, session_id, handoff_id, epoch, snapshot_digest |
| interrupt | type, schema_version, session_id, epoch, turn_id, reason |

The snapshot payload has session_id, handoff_id, epoch, turn_id, owner, from,
to, reason, history, slots, and interrupted_audio. owner/from are triage, to
is specialist, and reason is user_requested or scripted_scenario. Epoch is
positive. History has at most 32 entries with unique IDs and exact fields
id, role, text, source, completion. Roles are user/triage/specialist, text has
at most 512 code points, source is typed/fixture/recorded_annotation, and
completion is complete/interrupted.

Slots has exactly topic and reference. Topic is null/general/billing/technical;
reference is null or an identifier. Interrupted_audio is null or has audio_id,
turn_id, duration_ms, played_ms, reason. Duration is 1..10000 ms, position is
0..duration, and reason is manual/energy/handoff. The interruption message
uses that same reason enum. An energy reason is reserved for integrations;
the normal UI provides explicit controls, not speech recognition.

Canonical JSON sorts object keys, preserves array order, and uses JSON.stringify
string escaping, no whitespace, and no Unicode normalization. SHA256 covers
the payload's UTF-8 bytes. It checks equality of content, not authority.

## Audio and measurement

Each role has its own MediaStreamAudioDestinationNode and sender track.
Each incoming remote track feeds a separate receiver gate and role probe.
These feed a master gain, then the mix probe, then AudioContext.destination.
The probes pass samples through unchanged. No microphone monitoring is routed
to the speakers. Muted receiver gates cannot be reopened in the same session.

Remote streams also attach to media elements with both `muted=true` and
`volume=0`. Their `play()` promises must settle before connection readiness;
cleanup pauses them and clears srcObject. These elements activate Chromium's
remote audio consumption without a second audible path. In local diagnosis,
RTP counters increased while PCM stayed zero until this consumer was attached.
The WebRTC project's [Web Audio sample](https://webrtc.github.io/samples/src/content/peerconnection/webaudio-output/)
also attaches its remote stream to a media element. A related reference is
[Chromium issue 40094084](https://issues.chromium.org/issues/40094084); the local
measurement, rather than access to that issue's contents, justified this fix.

Worklets report non-overlapping 20 ms windows with round(sampleRate*0.020)
samples, RMS, audio timestamps, and a 64-point waveform. In-memory metrics keep
at most 2000 windows per probe and 256 event summaries, and the runtime keeps
the eight most recent imported or recorded clips. Closed/failed contexts
mark the samples stale. Recording has an independent worklet mode that passes
silence downstream and stops collecting at 480000 samples.

The calibration test uses a two-second 440 Hz sine with amplitude 0.2. Before
interrupt, the last ten received mix windows must each have RMS >=0.05 and the
source must have at least 1000 ms left. The interrupt captures t0 from the
AudioContext clock. The first full post window must start between t0+100 ms
and t0+120 ms, with one-sample tolerance. Ten consecutive windows must have
RMS <=0.001. Missing, late, malformed, or non-contiguous windows invalidate the
measurement rather than establish silence. The old role is observed longer
to detect a scheduled fragment returning after cancellation.

The negative control leaves its source, queue, and receiver gate untouched.
Its signal continues through the test interval and must fail the silence
assertion. A separate handoff test requires new specialist PCM after ACK and
silence from the old role. Selected ICE pairs are taken from transport stats'
selectedCandidatePairId, not guessed from another successful candidate pair.

`played_ms` is floor(clamp((stopContextTime-startContextTime)*1000, 0,
duration_ms)). Sources start with a small scheduling lead; time before that
start is not counted. This is the sender's playback timeline, not confirmation
of receiver playout or acoustic audibility.
