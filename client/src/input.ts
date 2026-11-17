import type { InputState } from './types.js';

/**
 * Створює обробник введення з клавіатури як замикання.
 * Стан клавіш зберігається у приватних змінних, недоступних ззовні.
 *
 * @param {HTMLElement | Window} target - Елемент, який слухає події (зазвичай window).
 * @returns {{ isDown: (code: string) => boolean, justPressed: (code: string) => boolean, endFrame: () => void }}
 */
export function createInput(target: Window | HTMLElement = window): InputState {
  // Приватний стан — ніхто ззовні не може його змінити
  const down = new Set();      // Клавіші, які зараз натиснуті
  const pressedThisFrame = new Set(); // Клавіші, які були натиснуті саме цього кадру

  function onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    // Якщо клавіша ще не була натиснута — це нове натискання
    if (!down.has(event.code)) {
      pressedThisFrame.add(event.code);
    }
    down.add(event.code);
  }

  function onKeyUp(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    down.delete(event.code);
  }

  // Слухаємо події
  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);

  // API назовні
  return {
    /**
     * Чи натиснута клавіша зараз?
     */
    isDown: (code) => down.has(code),

    /**
     * Чи була клавіша натиснута саме цього кадру?
     * Використовується для одноразових дій (постріл, стрибок).
     */
    justPressed: (code) => pressedThisFrame.has(code),

    /**
     * Викликати в кінці кожного кадру, щоб очистити "щойно натиснуті".
     */
    endFrame: () => {
      pressedThisFrame.clear();
    },
  };
}