/**
 * Глобальна шина подій. Використовує EventTarget, щоб будь-який модуль
 * міг підписатися на події або відправити їх, не знаючи про інші модулі.
 * 
 * Використання:
 *   events.addEventListener('fired', (e) => console.log(e.detail));
 *   events.dispatchEvent(new CustomEvent('fired', { detail: { x, y } }));
 */
export const events = new EventTarget();