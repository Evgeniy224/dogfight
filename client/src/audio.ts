import { events } from './events.js';

let audioContext: AudioContext | null = null;
const buffers: Record<string, AudioBuffer> = {};

export function setAudioContext(ctx: AudioContext): void {
  audioContext = ctx;
}

export function setBuffer(name: string, audioBuffer: AudioBuffer): void {
  buffers[name] = audioBuffer;
}

/**
 * Ініціалізувати звук при першому жесті (клік/натискання клавіші).
 */
export function unlockAudio(): void {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
    console.log('AudioContext resumed');
  }
}

export function playSound(name: string, volume = 0.3): void {
  if (!audioContext || !buffers[name]) return;
  if (audioContext.state === 'suspended') return; // не граємо, поки не розблоковано

  const source = audioContext.createBufferSource();
  source.buffer = buffers[name];
  const gain = audioContext.createGain();
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(audioContext.destination);
  source.start(0);
}

// Підписуємося на події
events.addEventListener('fired', () => playSound('shoot'));
events.addEventListener('exploded', () => playSound('explosion'));