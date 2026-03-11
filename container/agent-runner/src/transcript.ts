/**
 * Transcript archiving: save conversation history as markdown files.
 * Extracted from the original index.ts PreCompact hook logic.
 */
import fs from 'fs';
import path from 'path';
import type { ChatMessage } from './agent-loop.js';

const CONVERSATIONS_DIR = '/workspace/group/conversations';

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

function formatTranscriptMarkdown(
  messages: ParsedMessage[],
  title?: string | null,
  assistantName?: string,
): string {
  const now = new Date();
  const formatDateTime = (d: Date) =>
    d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : assistantName || 'Assistant';
    const content =
      msg.content.length > 2000
        ? msg.content.slice(0, 2000) + '...'
        : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Archive conversation messages to a markdown file.
 */
export function archiveConversation(
  messages: ChatMessage[],
  assistantName?: string,
): void {
  const parsed: ParsedMessage[] = [];
  for (const m of messages) {
    if ((m.role === 'user' || m.role === 'assistant') && m.content) {
      parsed.push({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      });
    }
  }

  if (parsed.length === 0) return;

  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });

  // Use first user message as title hint
  const firstUser = parsed.find((m) => m.role === 'user');
  const titleHint = firstUser
    ? firstUser.content.split('\n')[0].slice(0, 60)
    : null;
  const name = titleHint ? sanitizeFilename(titleHint) : generateFallbackName();

  const date = new Date().toISOString().split('T')[0];
  const filename = `${date}-${name}.md`;
  const filePath = path.join(CONVERSATIONS_DIR, filename);

  const markdown = formatTranscriptMarkdown(parsed, titleHint, assistantName);
  fs.writeFileSync(filePath, markdown);

  console.error(`[transcript] Archived conversation to ${filePath}`);
}
