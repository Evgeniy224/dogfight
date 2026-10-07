/**
 * Створює ігровий цикл з фіксованим кроком симуляції та рендерингом з інтерполяцією.
 */
export function createLoop({ step = 1 / 60, simulate, render }) {
  const MAX_FRAME_TIME = 0.25;

  let accumulator = 0;
  let lastTime = 0;
  let rafId = null;
  let running = false;

  let simStepsThisSecond = 0;
  let framesThisSecond = 0;
  let lastStatsTime = 0;
  let lastFrameDuration = 0;

  const stats = {
    stepsPerSecond: 0,
    framesPerSecond: 0,
    frameTime: 0,
  };

  function frame(now) {
    if (!running) return;

    const frameTime = Math.min((now - lastTime) / 1000, MAX_FRAME_TIME);
    lastTime = now;
    lastFrameDuration = frameTime * 1000;

    accumulator += frameTime;

    while (accumulator >= step) {
      simulate(step);
      accumulator -= step;
      simStepsThisSecond++;
    }

    const alpha = accumulator / step;
    render(alpha);
    framesThisSecond++;

    if (now - lastStatsTime >= 1000) {
      stats.stepsPerSecond = simStepsThisSecond;
      stats.framesPerSecond = framesThisSecond;
      stats.frameTime = lastFrameDuration;
      simStepsThisSecond = 0;
      framesThisSecond = 0;
      lastStatsTime = now;
    }

    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    lastStatsTime = lastTime;
    accumulator = 0;
    simStepsThisSecond = 0;
    framesThisSecond = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function getStats() {
    return { ...stats };
  }

  return { start, stop, getStats };
}