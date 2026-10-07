/**
 * Загортає позицію, якщо сутність вилітає за межі арени.
 * Тепер приймає Vector2 (об'єкт з x, y), а не Entity.
 *
 * @param {Vector2} pos - позиція сутності
 * @param {number} width
 * @param {number} height
 */
export function wrapAround(pos, width, height) {
  if (pos.x < 0) pos.x += width;
  if (pos.x > width) pos.x -= width;
  if (pos.y < 0) pos.y += height;
  if (pos.y > height) pos.y -= height;
}