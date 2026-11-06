# Engineering context

Real-time audio needs a defined cancellation boundary. Stopping a source does
not establish that buffered remote audio has disappeared. This project uses a
receiver gate and checks PCM after that gate. A state handoff must also reject
late acknowledgements after cancellation or session closure.

The lab addresses a problem relevant to voice infrastructure work at LiveKit,
Deepgram, Gradium, and ElevenLabs. It has no affiliation with these companies
and does not claim that they use or endorse this implementation.

Sources checked on 2026-11-06:

- [W3C WebRTC](https://www.w3.org/TR/webrtc/): peer connections, media tracks,
  data channels, and connection statistics.
- [MediaStreamAudioDestinationNode](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioDestinationNode):
  routing an authored Web Audio signal into a MediaStream.
- [AudioScheduledSourceNode.stop](https://developer.mozilla.org/en-US/docs/Web/API/AudioScheduledSourceNode/stop):
  stopping playback, including a source scheduled for the future.
- [Inbound RTP statistics](https://developer.mozilla.org/en-US/docs/Web/API/RTCInboundRtpStreamStats):
  packet and byte observations, separate from the final PCM measurement.
- [LiveKit interruptions](https://docs.livekit.io/agents/logic/turns/) and
  [agent handoffs](https://docs.livekit.io/agents/logic/agents-handoffs/):
  examples of the wider application problem. LiveKit is not bundled or used.
- [Playwright 1.62.0](https://pypi.org/project/playwright/1.62.0/): optional
  development dependency for the reproducible browser check.

The runtime uses browser APIs and procedural calibration tones. It does not
perform speech recognition, model inference, speech synthesis, semantic routing,
or a call between remote devices. Audio imported by the user stays in memory.
The visual composition is measured against
[Midlife Engineering](https://www.awwwards.com/sites/midlife-engineering), with
original interface assets and branding.

## Chromium audio integration

The initial local browser test received RTP packets while the Web Audio probes
remained at zero. Attaching each remote stream to a playing media element with
both `muted=true` and `volume=0` made the post-gate PCM measurable. The audible
branch remains the Web Audio graph. This behavior was isolated experimentally,
not inferred from packet counters. The
[Chromium issue](https://issues.chromium.org/issues/40094084) describes the same
class of remote-stream problem; the official
[WebRTC Web Audio output sample](https://webrtc.github.io/samples/src/content/peerconnection/webaudio-output/)
also attaches the received stream to a media element.

These observations concern the tested Chromium build. They do not establish
Safari, Firefox, mobile hardware, or acoustic output behavior.
