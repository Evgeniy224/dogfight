import { z } from 'zod';
import {
  ServerJoinedMessageSchema,
  ServerMessageSchema,
} from '@dogfight/shared/network';
import { requireElement, requireInput } from './types.js';

const LobbyRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  players: z.number().int().nonnegative(),
  maxPlayers: z.number().int().positive(),
}).strict();
const RoomsResponseSchema = z.object({
  rooms: z.array(LobbyRoomSchema),
}).strict();

export type LobbyRoom = z.infer<typeof LobbyRoomSchema>;
export type JoinedSession = z.infer<typeof ServerJoinedMessageSchema>;

export interface LobbyJoinDetail {
  room: LobbyRoom;
  playerName: string;
  ws: WebSocket;
  session: JoinedSession;
}

const LobbyJoinDetailSchema = z.object({
  room: LobbyRoomSchema,
  playerName: z.string(),
  ws: z.instanceof(WebSocket),
  session: ServerJoinedMessageSchema,
}).strict();

export class Lobby extends EventTarget {
  #rooms: LobbyRoom[] = [];
  #selectedRoom: LobbyRoom | null = null;
  #lobbyElement = requireElement('lobby-screen');
  #roomsListElement = requireElement('rooms-list');
  #nameInput = requireInput('player-name');
  #joinButton = requireElement('join-btn');
  #ws: WebSocket | null = null;

  constructor() {
    super();

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
      const data: unknown = await response.json();
      const parsed = RoomsResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error(`Invalid rooms response: ${parsed.error.message}`);
      this.#rooms = parsed.data.rooms;
      this.renderRooms();
      this.show();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to load rooms:', error);
      this.#lobbyElement.innerHTML = `<h1 style="color:red;">Failed to load rooms</h1><p>${message}</p><button onclick="location.reload()">Retry</button>`;
      this.show();
    }
  }

  renderRooms(): void {
    this.#roomsListElement.innerHTML = '';
    this.#rooms.forEach((room: LobbyRoom) => {
      const btn = document.createElement('button');
      btn.className = 'room-btn';
      btn.textContent = `${room.name} (${room.players}/${room.maxPlayers})`;
      btn.addEventListener('click', () => {
        this.#selectedRoom = room;
        document.querySelectorAll('.room-btn').forEach((button) => button.classList.remove('selected'));
        btn.classList.add('selected');
      });
      this.#roomsListElement.appendChild(btn);
    });
  }

  #connectAndJoin(roomId: string, playerName: string): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.#ws = ws;
    ws.binaryType = 'arraybuffer';
    const params = new URLSearchParams(location.search);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'join', roomId, playerName,
        codec: params.get('codec') === 'json' ? 'json' : 'binary',
        network: {
          latency: params.has('latency') ? Number(params.get('latency')) : 100,
          jitter: params.has('jitter') ? Number(params.get('jitter')) : 30,
          drop: params.has('drop') ? Number(params.get('drop')) : 0.02,
        },
      }));
    };

    ws.onmessage = (event: MessageEvent): void => {
      if (typeof event.data !== 'string') return;
      let untrusted: unknown;
      try {
        untrusted = JSON.parse(event.data);
      } catch (error: unknown) {
        console.warn('Invalid lobby JSON:', error);
        return;
      }
      const parsed = ServerMessageSchema.safeParse(untrusted);
      if (!parsed.success) {
        console.warn('Invalid lobby message:', parsed.error);
        return;
      }
      const selectedRoom = this.#selectedRoom;
      switch (parsed.data.type) {
        case 'joined':
          if (selectedRoom) {
            this.dispatchEvent(new CustomEvent<LobbyJoinDetail>('join', {
              detail: { room: selectedRoom, playerName, ws, session: parsed.data }
            }));
            this.#lobbyElement.classList.add('hidden');
          }
          return;
        case 'chat':
          console.log(`[Chat] ${parsed.data.playerName}: ${parsed.data.text}`);
          return;
        case 'snapshot':
        case 'pong':
          return;
        default: {
          const exhaustiveCheck: never = parsed.data;
          return exhaustiveCheck;
        }
      }
    };

    ws.onerror = (event: Event): void => {
      console.error('WebSocket error:', event);
    };

    ws.onclose = (event: CloseEvent): void => {
      console.log('WebSocket closed:', event.code, event.reason);
    };
  }

  onJoin(listener: (detail: LobbyJoinDetail) => void): void {
    this.addEventListener('join', (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (isLobbyJoinDetail(detail)) listener(detail);
    });
  }

  show(): void {
    this.#lobbyElement.classList.remove('hidden');
  }
}

function isLobbyJoinDetail(value: unknown): value is LobbyJoinDetail {
  return LobbyJoinDetailSchema.safeParse(value).success;
}