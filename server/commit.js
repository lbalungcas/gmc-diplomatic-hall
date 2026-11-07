/**
 * The commitment wall's room on the presence server. The rules are in src/commit/wallHub.js; this
 * carries its messages over the existing WebSocket and keeps the commitments safe.
 *
 * Render's disk is wiped on every restart, so the local file alone can't be trusted with a day's
 * commitments: Supabase (the `commitments` table, server/schema.sql) is the durable copy. The admin
 * panel shows a warning whenever Supabase isn't available.
 */
import { WebSocket } from 'ws';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createWallHub } from '../src/commit/wallHub.js';
import {
  isSupabaseEnabled, loadCommitments, saveCommitment, deleteCommitment, clearCommitments,
} from './supabase.js';

const TICK_MS = 300;
const FILE_DEBOUNCE_MS = 500;

export function createCommitRoom({ token, filePath }) {
  const fileItems = new Map();
  let fileTimer = null;
  let usingDb = false;

  function writeFileSoon() {
    if (fileTimer) return;
    fileTimer = setTimeout(() => {
      fileTimer = null;
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify([...fileItems.values()], null, 1));
      } catch (err) {
        console.warn('[commit] could not write file:', err.message);
      }
    }, FILE_DEBOUNCE_MS);
  }

  /** A blip on venue Wi-Fi or at Supabase shouldn't lose a commitment: try a few times first. */
  function toDb(write, attempt = 1) {
    write().catch((err) => {
      if (attempt < 4) {
        setTimeout(() => toDb(write, attempt + 1), attempt * 2000);
        return;
      }
      console.warn('[commit] database write failed:', err.message);
      usingDb = false;     // shows on the admin panel straight away
    });
  }

  const store = {
    save(item) {
      fileItems.set(item.id, item);
      writeFileSoon();
      if (usingDb) toDb(() => saveCommitment(item));
    },
    remove(id) {
      fileItems.delete(id);
      writeFileSoon();
      if (usingDb) toDb(() => deleteCommitment(id));
    },
    clear() {
      fileItems.clear();
      writeFileSoon();
      if (usingDb) toDb(() => clearCommitments());
    },
  };

  let lastMsg = null;
  let lastData = '';
  const hub = createWallHub({
    token,
    store,
    storage: () => (usingDb ? 'database' : 'file'),
    deliver(ws, msg) {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (msg !== lastMsg) {
        lastMsg = msg;
        lastData = JSON.stringify(msg);
      }
      ws.send(lastData);
    },
  });
  setInterval(() => hub.tick(), TICK_MS).unref();

  return {
    /** Loads saved commitments. Call once Supabase has had its chance to connect. */
    async boot() {
      let list = null;
      if (isSupabaseEnabled()) {
        try {
          list = await loadCommitments();
          usingDb = true;
          console.log(`[commit] loaded ${list.length} commitments from the database`);
        } catch (err) {
          console.warn('[commit] no commitments table, keeping them in a local file only:', err.message);
          console.warn('[commit] Run server/schema.sql in the Supabase SQL Editor, then restart.');
        }
      }
      if (!list) {
        try {
          list = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : [];
          if (!Array.isArray(list)) list = [];
          console.log(`[commit] loaded ${list.length} commitments from ${filePath}`);
        } catch (err) {
          console.warn('[commit] could not read file:', err.message);
          list = [];
        }
      }
      for (const i of list) fileItems.set(i.id, i);
      hub.hydrate(list);
    },

    /** Returns true if this was a commitment-wall message. */
    handle(ws, msg) {
      if (typeof msg.type !== 'string' || !msg.type.startsWith('commit_')) return false;
      hub.handle(ws, msg);
      return true;
    },
    drop: (ws) => hub.drop(ws),
    stats: () => hub.stats(),
  };
}
