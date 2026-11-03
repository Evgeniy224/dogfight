export class Lobby extends EventTarget {
  #rooms = [];
  #selectedRoom = null;
  #lobbyElement = null;
  #roomsListElement = null;
  #nameInput = null;
  #joinButton = null;
  #ws = null;

  constructor() {
    super();
    this.#lobbyElement = document.getElementById('lobby-screen');
    this.#roomsListElement = document.getElementById('rooms-list');
    this.#nameInput = document.getElementById('player-name');
    this.#joinButton = document.getElementById('join-btn');

    this.#joinButton.addEventListener('click', () => {
      if (!this.#selectedRoom) return;
      const playerName = this.#nameInput.value.trim() || 'Player';
      this.#connectAndJoin(this.#selectedRoom.id, playerName);
    });
  }

  async load() {
    try {
      const response = await fetch('/api/rooms');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.#rooms = data.rooms;
      this.renderRooms();
      this.show();
    } catch (e) {
      console.error('Failed to load rooms:', e);
      this.#lobbyElement.innerHTML = `<h1 style="color:red;">Failed to load rooms</h1><p>${e.message}</p><button onclick="location.reload()">Retry</button>`;
      this.show();
    }
  }

  renderRooms() {
    this.#roomsListElement.innerHTML = '';
    this.#rooms.forEach((room) => {
      const btn = document.createElement('button');
      btn.className = 'room-btn';
      btn.textContent = `${room.name} (${room.players}/${room.maxPlayers})`;
      btn.addEventListener('click', () => {
        this.#selectedRoom = room;
        document.querySelectorAll('.room-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      this.#roomsListElement.appendChild(btn);
    });
  }

  #connectAndJoin(roomId, playerName) {
    this.#ws = new WebSocket(`ws://${location.host}/ws`);

    this.#ws.onopen = () => {
      this.#ws.send(JSON.stringify({ type: 'join', roomId, playerName }));
    };

    this.#ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'joined') {
        this.dispatchEvent(new CustomEvent('join', {
          detail: { room: this.#selectedRoom, playerName, ws: this.#ws }
        }));
        this.#lobbyElement.classList.add('hidden');
      } else if (msg.type === 'chat') {
        console.log(`[Chat] ${msg.playerName}: ${msg.text}`);
      }
    };

    this.#ws.onerror = (e) => {
      console.error('WebSocket error:', e);
    };

    this.#ws.onclose = (e) => {
      console.log('WebSocket closed:', e.code, e.reason);
    };
  }

  show() {
    this.#lobbyElement.classList.remove('hidden');
  }
}