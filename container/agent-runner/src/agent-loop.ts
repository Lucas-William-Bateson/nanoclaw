/**
 * Core agentic loop: prompt -> check tool calls -> execute -> repeat.
 * Replaces the Claude Agent SDK's query() function.
 */
import {
  prompt as copilotPrompt,
  getFunctionCalls,
} from '@copilot-extensions/preview-sdk';
import type {
  PromptFunction,
  InteropMessage,
} from '@copilot-extensions/preview-sdk';
import { executeTool } from './tools/index.js';
import { trimMessages } from './context-manager.js';

// The SDK's InteropMessage.role is typed as "system" | "user" | "assistant"
// but OpenAI chat completions requires "tool" for tool results.
// The SDK's prompt() sends these correctly, the type just doesn't include it.
export type ChatMessage = InteropMessage & {
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export interface AgentLoopOptions {
  token: string;
  model: string;
  endpoint?: string;
  systemPrompt: string;
  tools: PromptFunction[];
  /** Mutable conversation history — grows during the loop. */
  messages: ChatMessage[];
  /** Safety limit on iterations (default 50). */
  maxIterations?: number;
  /** Callback when a tool is called (for logging). */
  onToolCall?: (name: string, args: string) => void;
  /** Callback when a text result is produced. */
  onResult?: (text: string) => void;
  /** Max tokens for context window management. */
  maxTokens?: number;
}

export interface AgentLoopResult {
  finalMessage: string;
  messages: ChatMessage[];
  iterations: number;
}

function log(message: string): void {
  console.error(`[agent-loop] ${message}`);
}

export async function runAgentLoop(
  userPrompt: string,
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxIterations = options.maxIterations ?? 50;
  const maxTokens = options.maxTokens ?? 128_000;

  // Add user message to history
  options.messages.push({ role: 'user', content: userPrompt });

  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    // Trim context if needed
    const systemTokens = Math.ceil(options.systemPrompt.length / 4);
    const trimmedMessages = trimMessages(options.messages, systemTokens, {
      maxTokens,
    });

    // Build messages array with system prompt prepended
    const messagesForApi: InteropMessage[] = [
      { role: 'system', content: options.systemPrompt },
      ...trimmedMessages,
    ];

    log(
      `Iteration ${iterations}: sending ${messagesForApi.length} messages (${options.tools.length} tools)`,
    );

    let result;
    try {
      result = await copilotPrompt({
        token: options.token,
        model: options.model,
        endpoint: options.endpoint,
        messages: messagesForApi,
        tools: options.tools.length > 0 ? options.tools : undefined,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Retry once on transient errors
      if (iterations <= maxIterations - 1 && errMsg.includes('429')) {
        log(`Rate limited, waiting 5s before retry...`);
        await new Promise((r) => setTimeout(r, 5000));
        iterations--; // Don't count rate-limit retries
        continue;
      }

      throw err;
    }

    const assistantMessage = result.message;

    // Add assistant response to conversation
    options.messages.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      ...(assistantMessage.tool_calls
        ? { tool_calls: assistantMessage.tool_calls }
        : {}),
    });

    // Check for tool calls
    const toolCalls = getFunctionCalls(result);

    if (toolCalls.length === 0) {
      // No tool calls — this is the final response
      const finalText = assistantMessage.content || '';
      log(`Final response (${finalText.length} chars)`);
      if (options.onResult && finalText) {
        options.onResult(finalText);
      }
      return {
        finalMessage: finalText,
        messages: options.messages,
        iterations,
      };
    }

    // Execute tool calls (in parallel when multiple)
    log(
      `${toolCalls.length} tool call(s): ${toolCalls.map((c) => c.function.name).join(', ')}`,
    );

    const toolResults = await Promise.all(
      toolCalls.map(async (call) => {
        const toolName = call.function.name;
        let toolArgs: Record<string, unknown>;
        try {
          toolArgs = JSON.parse(call.function.arguments);
        } catch {
          toolArgs = {};
        }

        if (options.onToolCall) {
          options.onToolCall(toolName, call.function.arguments);
        }

        const resultText = await executeTool(toolName, toolArgs);

        log(
          `  ${toolName}: ${resultText.slice(0, 200)}${resultText.length > 200 ? '...' : ''}`,
        );

        return {
          role: 'tool',
          content: resultText,
          tool_call_id: call.id,
        } as unknown as ChatMessage;
      }),
    );

    // Add all tool results to conversation
    for (const tr of toolResults) {
      options.messages.push(tr);
    }
  }

  // Max iterations reached
  const errorMsg = `Agent loop reached maximum iterations (${maxIterations})`;
  log(errorMsg);
  return {
    finalMessage: errorMsg,
    messages: options.messages,
    iterations,
  };
}
