import { Room } from './Room.js';
import { genRoomCode } from '../src/net/protocol.js';

/** Registry of active rooms, keyed by their short code. */
export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  createRoom() {
    let code = genRoomCode();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = genRoomCode();
    const room = new Room(code, () => this.rooms.delete(code));
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || '').toUpperCase()) || null;
  }

  get count() {
    return this.rooms.size;
  }
}
