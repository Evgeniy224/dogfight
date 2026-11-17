// client/src/netgraph.js
export class Netgraph {
  rtt = 0;
  snapshotAge = 0;
  bytesPerSec = 0;
  pendingQueueLength = 0;
  errorMagnitude = 0;
  interpolationDelay = 100;
  predictionMode: 'prediction' | 'snapshot-only' = 'prediction';
  private bytesCounter = 0;
  private lastBytesCheck = performance.now();

  addBytes(count: number): void {
    this.bytesCounter += count;
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastBytesCheck >= 1000) {
      this.bytesPerSec = this.bytesCounter;
      this.bytesCounter = 0;
      this.lastBytesCheck = now;
    }
  }

  render(ctx: CanvasRenderingContext2D, x = 10, y = 100): void {
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