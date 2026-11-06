/** Chromium needs a consuming media element to keep remote WebRTC audio flowing. */
export class RemoteMediaSink {
    constructor(stream, createElement = () => new Audio()) {
        this.element = createElement();
        this.element.muted = true;
        this.element.volume = 0;
        this.element.autoplay = true;
        this.element.srcObject = stream;
        this.closed = false;
    }
    async start() {
        try {
            await this.element.play();
            if (this.closed) {
                this.element.pause();
                this.element.srcObject = null;
                return false;
            }
            return true;
        }
        catch {
            this.close();
            throw new Error('audio_blocked');
        }
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.element.pause();
        this.element.srcObject = null;
    }
}
