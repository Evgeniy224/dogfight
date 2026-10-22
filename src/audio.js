import { events } from './events.js';

let audioContext = null;
const buffers = {};

export function setAudioContext(ctx) {
  audioContext = ctx;
}

export function setBuffer(name, audioBuffer) {
  buffers[name] = audioBuffer;
}

/**
 * Ініціалізувати звук при першому жесті (клік/натискання клавіші).
 */
export function unlockAudio() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
    console.log('AudioContext resumed');
  }
}

export function playSound(name, volume = 0.3) {
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