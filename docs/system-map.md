# System map: realtime-voice-handoff

Each diagram shows one real path through this repository. A highlighted box is a step that can reject its input; a vertical bar marks the boundary between zones.

[Back to the README](../README.md)

## The handoff transaction step by step

Starting a handoff cancels triage audio and opens a two-second window. The specialist validates the snapshot and answers with an acknowledgement, and the caller changes owner only if all four values in it match.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="system-map/handoff-ack-dark.svg">
  <img src="system-map/handoff-ack-light.svg" alt="The caller cancels triage, raises the epoch and sends a snapshot with a SHA-256 digest. The specialist validates it, recomputes the digest and returns handoff_ack. The caller accepts it only when session, handoff id, epoch and digest match before the deadline." width="100%">
</picture>

Source: [`src/controller.js`](../src/controller.js), [`src/protocol.js`](../src/protocol.js), [`src/schema.js`](../src/schema.js), [`tests/contracts.test.js`](../tests/contracts.test.js)

## How interruption silences the old role

Stopping the sender is not enough, because packets may already be in flight. The old receiver gate is set to zero for the rest of the session, and a probe behind it measures what actually reaches the output.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="system-map/interrupt-silence-dark.svg">
  <img src="system-map/interrupt-silence-light.svg" alt="An interrupt stops active and scheduled sources at once. The receiver gate of that role is set to zero and cannot be reopened in the session. A PCM probe reports 20 ms RMS windows from the output branch." width="100%">
</picture>

Source: [`src/audio-tracks.js`](../src/audio-tracks.js), [`src/audio-probe.js`](../src/audio-probe.js), [`src/runtime.js`](../src/runtime.js), [`tests/audio.test.js`](../tests/audio.test.js)

## What happens to a bad message

Every data channel message is decoded under byte and depth limits and matched against a closed schema. A well-formed but stale, foreign or late acknowledgement is ignored and the specialist stays blocked.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="system-map/wire-rejection-dark.svg">
  <img src="system-map/wire-rejection-light.svg" alt="A binary message is decoded as strict UTF-8 JSON within 16384 bytes and eight levels. Its fields must match one of three closed message schemas. The controller then compares it with the pending handoff and ignores anything that does not match." width="100%">
</picture>

Source: [`src/schema.js`](../src/schema.js), [`src/protocol.js`](../src/protocol.js), [`src/controller.js`](../src/controller.js), [`tests/contracts.test.js`](../tests/contracts.test.js)

## The command-line demo

The demo runs a handoff request through the real controller and wire protocol with an in-memory transport. No audio is executed; it reports five checks or a full JSON trace.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="system-map/controller-demo-dark.svg">
  <img src="system-map/controller-demo-light.svg" alt="A handoff request comes from the --input file or the built-in default. An unreadable or invalid request exits 2 with one line. The controller and protocol run the whole handoff, and the demo prints five checks or the trace." width="100%">
</picture>

Source: [`examples/demo.js`](../examples/demo.js), [`examples/handoff.json`](../examples/handoff.json), [`examples/demo.json`](../examples/demo.json), [`tests/demo-cli.test.js`](../tests/demo-cli.test.js)

## Proving silence in a real browser

The browser harness plays a calibration tone over the real WebRTC path. It refuses to judge silence without a received signal first, and a deliberately broken cancellation must fail the same test.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="system-map/browser-measurement-dark.svg">
  <img src="system-map/browser-measurement-light.svg" alt="A 440 Hz calibration tone is played and must be received before the interrupt. After it, ten consecutive windows must have RMS at most 0.001. A negative control without cancellation must fail that assertion." width="100%">
</picture>

Source: [`tests/browser-harness.js`](../tests/browser-harness.js), [`qa/browser_check.py`](../qa/browser_check.py), [`examples/browser-measurement.json`](../examples/browser-measurement.json), [`docs/design.md`](../docs/design.md)

## Which file does which step

runtime.js is the entry point behind createVoiceLab. audio-probe.js supplies the measuring worklet and media-sink.js keeps remote audio flowing in Chromium.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="system-map/module-map-dark.svg">
  <img src="system-map/module-map-light.svg" alt="schema.js and wav.js parse bounded input. controller.js and protocol.js own state and the handoff messages. rtc.js and audio-tracks.js carry and gate real audio. runtime.js joins them for the page." width="100%">
</picture>

Source: [`src/schema.js`](../src/schema.js), [`src/wav.js`](../src/wav.js), [`src/controller.js`](../src/controller.js), [`src/protocol.js`](../src/protocol.js), [`src/rtc.js`](../src/rtc.js), [`src/audio-tracks.js`](../src/audio-tracks.js), [`src/runtime.js`](../src/runtime.js)

## How it is verified

Unit tests cover the controller, schemas and audio bookkeeping without a browser. A second CI job rebuilds the page and runs the browser check in Chrome.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="system-map/ci-checks-dark.svg">
  <img src="system-map/ci-checks-light.svg" alt="A push or pull request starts the contracts job with npm test and the showcase controller tests on Node 22. The browser job rebuilds docs/index.html, requires no difference and then runs qa/browser_check.py with Chrome." width="100%">
</picture>

Source: [`.github/workflows/checks.yml`](../.github/workflows/checks.yml), [`package.json`](../package.json), [`qa/browser_check.py`](../qa/browser_check.py), [`tools/build_showcase.py`](../tools/build_showcase.py)
