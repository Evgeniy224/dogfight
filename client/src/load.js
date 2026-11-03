/**
 * Завантаження ресурсів: картинки, звук, JSON.
 */

/**
 * Завантажити JSON з перевіркою статусу.
 */
export async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

/**
 * Завантажити картинку (PNG, SVG тощо).
 */
export function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    if (signal) {
      signal.addEventListener('abort', () => {
        img.src = '';
        reject(new Error('Aborted'));
      });
    }
    img.src = url;
  });
}

/**
 * Завантажити аудіо як ArrayBuffer (потім декодуємо в AudioContext).
 */
export async function loadAudioBuffer(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.arrayBuffer();
}

/**
 * Завантажити ВСІ ресурси з маніфесту паралельно.
 */
export async function loadAll(manifest, onProgress, signal) {
  const imageEntries = Object.entries(manifest.images || {});
  const soundEntries = Object.entries(manifest.sounds || {});
  const total = imageEntries.length + soundEntries.length;
  let loaded = 0;

  const images = {};
  const sounds = {};

  // Картинки
  const imagePromises = imageEntries.map(async ([key, url]) => {
    const img = await loadImage(url, signal);
    images[key] = img;
    loaded++;
    onProgress?.(loaded, total);
  });

  // Звуки
  const soundPromises = soundEntries.map(async ([key, url]) => {
    const buffer = await loadAudioBuffer(url, signal);
    sounds[key] = buffer;
    loaded++;
    onProgress?.(loaded, total);
  });

  await Promise.all([...imagePromises, ...soundPromises]);

  return { images, sounds };
}