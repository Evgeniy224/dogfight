import { fetchJson } from './load.js';

/**
 * Лобі: показує список кімнат, дозволяє вибрати, повертає конфіг.
 * Наслідує EventTarget, щоб генерувати подію "join" з обраною кімнатою.
 */
export class Lobby extends EventTarget {
  #rooms = [];
  #selectedRoom = null;
  #lobbyElement = null;
  #roomsListElement = null;
  #nameInput = null;
  #joinButton = null;

  constructor() {
    super();
    this.#lobbyElement = document.getElementById('lobby-screen');
    this.#roomsListElement = document.getElementById('rooms-list');
    this.#nameInput = document.getElementById('player-name');
    this.#joinButton = document.getElementById('join-btn');

    this.#joinButton.addEventListener('click', () => {
      if (!this.#selectedRoom) return;
      const playerName = this.#nameInput.value.trim() || 'Player';
      this.dispatchEvent(new CustomEvent('join', {
        detail: { room: this.#selectedRoom, playerName }
      }));
      this.#lobbyElement.classList.add('hidden');
    });
  }

  async load() {
    const data = await fetchJson('/assets/rooms.json');
    this.#rooms = data.rooms;
    this.renderRooms();
    this.show();
  }

  renderRooms() {
    this.#roomsListElement.innerHTML = '';
    this.#rooms.forEach((room) => {
      const btn = document.createElement('button');
      btn.className = 'room-btn';
      btn.textContent = `${room.name} (${room.players}/${room.maxPlayers})`;
      btn.addEventListener('click', () => {
        this.#selectedRoom = room;
        // Знімаємо виділення з усіх, потім виділяємо цю
        document.querySelectorAll('.room-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      this.#roomsListElement.appendChild(btn);
    });
  }

  show() {
    this.#lobbyElement.classList.remove('hidden');
  }
}