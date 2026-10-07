/**
 * Загортає координати корабля, якщо він вилітає за межі арени.
 * Корабель, що вилітає справа, з'являється зліва, і навпаки.
 *
 * @param {object} ship - об'єкт корабля
 * @param {number} width - ширина арени в пікселях
 * @param {number} height - висота арени в пікселях
 */
export function wrapAround(ship, width, height) {
  if (ship.x < 0) ship.x += width;
  if (ship.x > width) ship.x -= width;
  if (ship.y < 0) ship.y += height;
  if (ship.y > height) ship.y -= height;
}