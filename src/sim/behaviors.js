/**
 * Композиційні поведінки. Замість того, щоб робити класи
 * `HomingBullet`, `HomingAsteroid`, `HomingShip` — ми додаємо
 * об'єкт `homing` як поле на будь-яку сутність.
 *
 * Це дозволяє комбінувати поведінки без вибуху дерева класів.
 */

/**
 * Створює поведінку "наведення". Сутність буде плавно повертати
 * свою швидкість у бік цілі.
 *
 * @param {number} turnRate - швидкість повороту (рад/с)
 * @returns {object} об'єкт поведінки
 */
export function createHoming(turnRate = 3.0) {
  return {
    turnRate,
    /**
     * Оновлює швидкість сутності, повертаючи її до цілі.
     * @param {Entity} self - сутність, яка має цю поведінку
     * @param {Entity} target - ціль
     * @param {number} dt
     */
    update(self, target, dt) {
      if (!target || !target.alive) return;

      // Напрямок на ціль
      const dx = target.pos.x - self.pos.x;
      const dy = target.pos.y - self.pos.y;
      const targetAngle = Math.atan2(dy, dx);

      // Поточний напрямок руху
      const currentAngle = Math.atan2(self.vel.y, self.vel.x);

      // Різниця кутів (нормалізована до [-π, π])
      let diff = targetAngle - currentAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      // Повертаємо на частину різниці
      const turn = Math.sign(diff) * Math.min(Math.abs(diff), this.turnRate * dt);
      const newAngle = currentAngle + turn;

      // Зберігаємо швидкість, але змінюємо напрямок
      const speed = Math.hypot(self.vel.x, self.vel.y);
      self.vel.x = Math.cos(newAngle) * speed;
      self.vel.y = Math.sin(newAngle) * speed;
    },
  };
}

/**
 * Створює поведінку "підбирач". Сутність стоїть на місці,
 * але при зіткненні з кораблем дає йому бонус.
 *
 * @param {string} type - 'shield' або 'rapid_fire'
 * @returns {object} об'єкт поведінки
 */
export function createPickup(type = 'shield') {
  return {
    type,
    /**
     * Застосовує ефект до цілі (корабля).
     * @param {Ship} target
     */
    apply(target) {
      if (type === 'shield') {
        target.shield = 5; // 5 секунд захисту
      } else if (type === 'rapid_fire') {
        target.rapidFire = 5; // 5 секунд швидкої стрільби
      }
    },
  };
}