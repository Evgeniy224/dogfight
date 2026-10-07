/**
 * Створює обробник введення з клавіатури як замикання.
 * Стан клавіш зберігається у приватних змінних, недоступних ззовні.
 *
 * @param {HTMLElement | Window} target - Елемент, який слухає події (зазвичай window).
 * @returns {{ isDown: (code: string) => boolean, justPressed: (code: string) => boolean, endFrame: () => void }}
 */
export function createInput(target = window) {
  // Приватний стан — ніхто ззовні не може його змінити
  const down = new Set();      // Клавіші, які зараз натиснуті
  const pressedThisFrame = new Set(); // Клавіші, які були натиснуті саме цього кадру

  function onKeyDown(e) {
    // Якщо клавіша ще не була натиснута — це нове натискання
    if (!down.has(e.code)) {
      pressedThisFrame.add(e.code);
    }
    down.add(e.code);
  }

  function onKeyUp(e) {
    down.delete(e.code);
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