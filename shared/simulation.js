import { Ship } from './ship.js';
import { Asteroid } from './asteroid.js';
import { World } from './world.js';

/**
 * Створює початковий світ для гри.
 * @param {number} width 
 * @param {number} height 
 * @param {number} seed - для детермінованого створення астероїдів (поки що просто ігноруємо)
 */
export function createWorld(width, height, seed = 1) {
  const world = new World();
  
  // Створюємо корабель
  const ship = world.spawn(new Ship(width / 2, height / 2));
  
  // Створюємо астероїди (детерміновано, якщо треба)
  for (let i = 0; i < 12; i++) {
    let x, y;
    do {
      x = Math.random() * width;
      y = Math.random() * height;
    } while (Math.hypot(x - ship.pos.x, y - ship.pos.y) < 200);
    
    const vx = (Math.random() - 0.5) * 100;
    const vy = (Math.random() - 0.5) * 100;
    world.spawn(new Asteroid(x, y, vx, vy, Math.floor(Math.random() * 3)));
  }
  
  return { world, ship };
}

/**
 * Робить один крок симуляції.
 * @param {World} world 
 * @param {number} dt - фіксований крок (1/30 для мережі)
 * @param {object} inputs - об'єкт з інпутами для кожного гравця (поки що один гравець)
 * @param {number} width 
 * @param {number} height 
 */
export function stepSimulation(world, dt, inputs, width, height) {
  // Оновлюємо всі сутності
  world.step(dt, inputs, width, height);
  
  // Тут будуть колізії, але для сервера ми поки що їх не обробляємо,
  // бо це Lab 05, а колізії будуть у Lab 06.
}