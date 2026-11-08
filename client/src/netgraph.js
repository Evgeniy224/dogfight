// client/src/netgraph.js
export class Netgraph {
  constructor() {
    this.rtt = 0;
    this.snapshotAge = 0;
    this.bytesPerSec = 0;
    this.pendingQueueLength = 0;
    this.errorMagnitude = 0;
    this.interpolationDelay = 100;
    this.predictionMode = 'prediction'; // 'delay' або 'prediction'

    this.bytesCounter = 0;
    this.lastBytesCheck = performance.now();
  }

  addBytes(count) {
    this.bytesCounter += count;
  }

  update() {
    const now = performance.now();
    if (now - this.lastBytesCheck >= 1000) {
      this.bytesPerSec = this.bytesCounter;
      this.bytesCounter = 0;
      this.lastBytesCheck = now;
    }
  }

  render(ctx, x = 10, y = 100) {
    this.update();
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x, y, 230, 148);
    ctx.strokeStyle = '#4af';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, 230, 148);

    ctx.font = '12px monospace';
    ctx.fillStyle = '#0f0';
    ctx.fillText(`--- NETGRAPH ---`, x + 10, y + 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(`Mode: ${this.predictionMode}`, x + 10, y + 38);
    ctx.fillText(`RTT: ${Math.round(this.rtt)} ms`, x + 10, y + 54);
    ctx.fillText(`Snapshot Age: ${Math.round(this.snapshotAge)} ms`, x + 10, y + 70);
    ctx.fillText(`Traffic: ${(this.bytesPerSec / 1024).toFixed(2)} KB/s`, x + 10, y + 86);
    ctx.fillText(`Input Queue: ${this.pendingQueueLength}`, x + 10, y + 102);
    ctx.fillText(`Interpolation: ${this.interpolationDelay} ms`, x + 10, y + 118);

    const errColor = this.errorMagnitude > 5 ? '#f44' : '#4f4';
    ctx.fillStyle = errColor;
    ctx.fillText(`Correction Err: ${this.errorMagnitude.toFixed(2)} px`, x + 10, y + 134);

    ctx.restore();
  }
}