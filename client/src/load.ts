/**
 * Завантаження ресурсів: картинки, звук, JSON.
 */

/**
 * Завантажити JSON з перевіркою статусу.
 */
export async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseAssetManifest(value: unknown): AssetManifest {
  if (!isRecord(value)) {
    throw new Error('Invalid asset manifest');
  }
  const isAssetMap = (entry: unknown): entry is Record<string, string> =>
    typeof entry === 'object'
    && entry !== null
    && Object.values(entry).every((url) => typeof url === 'string');
  if (
    (value.images !== undefined && !isAssetMap(value.images))
    || (value.sounds !== undefined && !isAssetMap(value.sounds))
  ) {
    throw new Error('Invalid asset manifest');
  }
  return {
    ...(value.images === undefined ? {} : { images: value.images }),
    ...(value.sounds === undefined ? {} : { sounds: value.sounds }),
  };
}

/**
 * Завантажити картинку (PNG, SVG тощо).
 */
export function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
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
export async function loadAudioBuffer(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.arrayBuffer();
}

/**
 * Завантажити ВСІ ресурси з маніфесту паралельно.
 */
export async function loadAll(
  manifest: AssetManifest,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<LoadedAssets> {
  const imageEntries = Object.entries(manifest.images || {});
  const soundEntries = Object.entries(manifest.sounds || {});
  const total = imageEntries.length + soundEntries.length;
  let loaded = 0;

  const images: Record<string, HTMLImageElement> = {};
  const sounds: Record<string, ArrayBuffer> = {};

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
import type { AssetManifest, LoadedAssets, ProgressCallback } from './types.js';
