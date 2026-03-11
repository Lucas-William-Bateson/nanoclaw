/**
 * NanoClaw Agent Runner (Copilot SDK)
 * Runs inside a container, receives config via stdin, outputs result to stdout.
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted per session.
 */

import fs from 'fs';
import path from 'path';

// Import and register all tools (side effects: each module calls registerTool())
import './tools/bash.js';
import './tools/read.js';
import './tools/write.js';
import './tools/edit.js';
import './tools/glob.js';
import './tools/grep.js';
import './tools/web-fetch.js';
import './tools/web-search.js';
import './tools/todo-write.js';
import './tools/notebook-edit.js';
import './tools/nanoclaw.js';

import { getAllToolDefinitions } from './tools/index.js';
import { initNanoClawContext } from './tools/nanoclaw.js';
import { runAgentLoop } from './agent-loop.js';
import { buildSystemPrompt } from './system-prompt.js';
import { generateSessionId, loadSession, saveSession } from './session.js';
import { archiveConversation } from './transcript.js';
import type { SessionData } from './session.js';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try {
      fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
}

function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs
      .readdirSync(IPC_INPUT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(
          `Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore */
        }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    try {
      fs.unlinkSync('/tmp/input.json');
    } catch {
      /* may not exist */
    }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  // Initialize NanoClaw IPC tool context
  initNanoClawContext({
    chatJid: containerInput.chatJid,
    groupFolder: containerInput.groupFolder,
    isMain: containerInput.isMain,
  });

  // Credentials are injected by the host's credential proxy via COPILOT_ENDPOINT.
  const token = process.env.COPILOT_TOKEN || 'placeholder';
  const model = process.env.COPILOT_MODEL || 'gpt-4o';
  const endpoint = process.env.COPILOT_ENDPOINT || undefined;

  // Build system prompt from CLAUDE.md files and context
  const systemPrompt = buildSystemPrompt({
    assistantName: containerInput.assistantName,
    isMain: containerInput.isMain,
    chatJid: containerInput.chatJid,
    groupFolder: containerInput.groupFolder,
    timezone: process.env.TZ || 'UTC',
  });

  // Load or create session
  let session: SessionData;
  if (containerInput.sessionId) {
    const loaded = loadSession(containerInput.sessionId);
    if (loaded) {
      session = loaded;
      log(
        `Resumed session: ${session.id} (${session.messages.length} messages)`,
      );
    } else {
      session = {
        id: containerInput.sessionId,
        messages: [],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      };
      log(`Session ${containerInput.sessionId} not found, starting fresh`);
    }
  } else {
    session = {
      id: generateSessionId(),
      messages: [],
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    log(`New session: ${session.id}`);
  }

  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous runs
  try {
    fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL);
  } catch {
    /* ignore */
  }

  // Build initial prompt
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Get all tool definitions
  const tools = getAllToolDefinitions();
  log(`Registered ${tools.length} tools`);

  // Query loop: run agent loop → wait for IPC → run again → repeat
  try {
    while (true) {
      log(
        `Starting agent loop (session: ${session.id}, messages: ${session.messages.length})...`,
      );

      const result = await runAgentLoop(prompt, {
        token,
        model,
        endpoint,
        systemPrompt,
        tools,
        messages: session.messages,
        onToolCall: (name, args) => {
          log(`Tool call: ${name}(${args.slice(0, 100)})`);
        },
        onResult: (text) => {
          log(`Result: ${text.slice(0, 200)}`);
        },
      });

      // Write result output
      writeOutput({
        status: 'success',
        result: result.finalMessage || null,
        newSessionId: session.id,
      });

      // Save session after each query
      saveSession(session);

      // Check if _close happened during query (polled externally)
      if (shouldClose()) {
        log('Close sentinel detected after query, exiting');
        break;
      }

      // Emit session update so host can track it
      writeOutput({
        status: 'success',
        result: null,
        newSessionId: session.id,
      });

      log('Query ended, waiting for next IPC message...');

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: session.id,
      error: errorMessage,
    });

    // Archive conversation on error
    archiveConversation(session.messages, containerInput.assistantName);
    saveSession(session);
    process.exit(1);
  }

  // Archive conversation on clean exit
  if (session.messages.length > 0) {
    archiveConversation(session.messages, containerInput.assistantName);
  }
  saveSession(session);
}

main();
