/**
 * Context window management: trim conversation history when it grows too long.
 */
import type { ChatMessage } from './agent-loop.js';

// Rough token estimation: ~4 chars per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messagesToTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content || '') + 4, // 4 tokens overhead per message
    0,
  );
}

export interface ContextManagerOptions {
  /** Max tokens for the model's context window (default 128000 for GPT-4o) */
  maxTokens: number;
  /** Tokens reserved for the response (default 8000) */
  reserveForResponse: number;
  /** Messages to always keep at the end (default 30) */
  keepLastMessages: number;
}

const DEFAULT_OPTIONS: ContextManagerOptions = {
  maxTokens: 128_000,
  reserveForResponse: 8_000,
  keepLastMessages: 30,
};

/**
 * Trim messages array if it exceeds the context window budget.
 * Strategy: keep first message + summary of middle + last N messages.
 * Returns the trimmed array (does not mutate the original).
 */
export function trimMessages(
  messages: ChatMessage[],
  systemPromptTokens: number,
  options?: Partial<ContextManagerOptions>,
): ChatMessage[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const available =
    opts.maxTokens - opts.reserveForResponse - systemPromptTokens;
  const currentTokens = messagesToTokens(messages);

  if (currentTokens <= available) return messages;

  // If few enough messages, can't trim further
  if (messages.length <= opts.keepLastMessages + 1) return messages;

  const first = messages[0];
  const last = messages.slice(-opts.keepLastMessages);
  const middle = messages.slice(1, messages.length - opts.keepLastMessages);

  // Summarize the middle section
  const topicSet = new Set<string>();
  for (const m of middle) {
    const content = m.content || '';
    // Extract first line or first 80 chars as a topic hint
    const firstLine = content.split('\n')[0].slice(0, 80);
    if (firstLine) topicSet.add(firstLine);
    if (topicSet.size >= 10) break;
  }

  const topics = Array.from(topicSet).join('; ');
  const summary: ChatMessage = {
    role: 'system',
    content: `[Context trimmed: ${middle.length} messages removed. Topics discussed: ${topics}]`,
  };

  return [first, summary, ...last];
}
