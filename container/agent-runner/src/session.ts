/**
 * Session persistence: save/load conversation message arrays.
 */
import fs from 'fs';
import path from 'path';
import type { ChatMessage } from './agent-loop.js';

const SESSION_DIR = '/workspace/sessions';

export interface SessionData {
  id: string;
  messages: ChatMessage[];
  createdAt: string;
  lastUpdatedAt: string;
}

export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveSession(session: SessionData): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const filePath = path.join(SESSION_DIR, `${session.id}.json`);
  session.lastUpdatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(session));
}

export function loadSession(sessionId: string): SessionData | null {
  const filePath = path.join(SESSION_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
