/** PCM measurements at the actual output branch; not acoustic measurements. */
export class RmsAccumulator {
    constructor(rate) {
        this.rate = rate;
        this.length = Math.round(rate * .020);
        this.count = 0;
        this.sum = 0;
        this.start = 0;
        this.next = null;
        this.wave = new Float32Array(this.length);
    }
    push(samples, frame) {
        const result = [];
        if (this.next !== null && frame !== this.next) {
            this.count = 0;
            this.sum = 0;
        }
        for (let i = 0; i < samples.length; i++) {
            if (this.count === 0)
                this.start = frame + i;
            const sample = samples[i];
            this.wave[this.count] = sample;
            this.sum += sample * sample;
            this.count++;
            if (this.count === this.length) {
                const waveform = Array.from({
                    length: 64
                }, (_, j) => this.wave[Math.min(this.length - 1, Math.floor(j * this.length / 64))]);
                result.push({
                    startTime: this.start / this.rate, endTime: (frame + i + 1) / this.rate, rms: Math.sqrt(this.sum / this.length), samples: this.length, waveform
                });
                this.count = 0;
                this.sum = 0;
            }
        }
        this.next = frame + samples.length;
        return result;
    }
}
export function assessSilence(windows, t0, remainingMs, sampleRate = 48000) {
    if (!Array.isArray(windows) || !Number.isFinite(t0) || t0 < 0 || !Number.isFinite(remainingMs) ||
        !Number.isFinite(sampleRate) || sampleRate <= 0 || windows.some(w => !w || !Number.isFinite(w.startTime) ||
        !Number.isFinite(w.endTime) || !Number.isFinite(w.rms) || w.rms < 0 || !Number.isInteger(w.samples) || w.samples <= 0)) {
        return {
            status: 'INVALID', reason: 'measurement_precondition', before: [], after: []
        };
    }
    const before = windows.filter(w => w.endTime <= t0 + 1e-8).slice(-10);
    const after = windows.filter(w => w.startTime >= t0 + .1 - 1e-8).slice(0, 10);
    const contiguous = list => list.every((w, i) => i === 0 || Math.abs(w.startTime - list[i - 1].endTime) < 1e-6);
    const validWindow = w => w.samples === Math.round(sampleRate * .020) && Math.abs((w.endTime - w.startTime) - w.samples / sampleRate) <= 1 / sampleRate;
    if (remainingMs < 1000 || before.length !== 10 || after.length !== 10 || !contiguous(before) || !contiguous(after) ||
        after[0]?.startTime > t0 + .12 + 1 / sampleRate || [...before, ...after].some(w => !validWindow(w)) ||
        Math.abs(before[9].endTime - t0) > .021 || before.some(w => w.rms < .05))
        return {
            status: 'INVALID', reason: 'measurement_precondition', before, after
        };
    const pass = after.every(w => w.rms <= .001);
    const later = windows.filter(w => w.startTime >= t0);
    let stableAt = null;
    for (let i = 0; i + 9 < later.length; i++) {
        const block = later.slice(i, i + 10);
        if (contiguous(block) && block.every(w => w.rms <= .001)) {
            stableAt = (block[0].startTime - t0) * 1000;
            break;
        }
    }
    return {
        status: pass ? 'PASS' : 'FAIL', reason: pass ? 'measured_silence' : 'audio_still_present', t0, remainingMs, stableSilenceMs: stableAt, before, after
    };
}
export function probeSource() {
    return `${RmsAccumulator.toString()}
class VoicePcmProbe extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.mode=options.processorOptions?.mode||'probe';this.rms=new RmsAccumulator(sampleRate);
    this.limit=options.processorOptions?.maxSamples||480000;this.count=0;this.done=false;
    this.port.onmessage=event=>{if(event.data?.type==='stop')this.finish();};
  }
  finish(){if(!this.done){this.done=true;this.port.postMessage({type:'done',samples:this.count});}}
  process(inputs,outputs) {
    const input=inputs[0]||[],output=outputs[0]||[];
    const length=output[0]?.length||input[0]?.length||128;
    const mono=new Float32Array(length);
    for(let i=0;i<length;i++){for(const channel of input)mono[i]+=channel[i]||0;if(input.length)mono[i]/=input.length;}
    if(this.mode==='record') {
      for(const channel of output)channel.fill(0);
      if(this.done)return false;
      const take=Math.min(length,this.limit-this.count);
      if(take>0){const samples=mono.slice(0,take);this.port.postMessage({type:'pcm',samples},[samples.buffer]);this.count+=take;}
      if(this.count>=this.limit)this.finish();return !this.done;
    }
    for(const channel of output)channel.set(mono);
    for(const window of this.rms.push(mono,currentFrame))this.port.postMessage({type:'window',...window});
    return true;
  }
}
registerProcessor('voice-pcm-probe',VoicePcmProbe);`;
}
