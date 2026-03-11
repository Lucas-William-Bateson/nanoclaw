/**
 * Tool registry: registration, definition retrieval, and dispatch.
 */
import type { PromptFunction } from '@copilot-extensions/preview-sdk';
import type { ToolImplementation } from './types.js';

const tools = new Map<string, ToolImplementation>();

export function registerTool(impl: ToolImplementation): void {
  tools.set(impl.definition.function.name, impl);
}

export function getAllToolDefinitions(): PromptFunction[] {
  return Array.from(tools.values()).map((t) => t.definition);
}

/**
 * Filter tools by an allowlist with glob support (e.g. "nanoclaw_*").
 */
export function getToolDefinitions(allowed: string[]): PromptFunction[] {
  return getAllToolDefinitions().filter((t) => {
    const name = t.function.name;
    return allowed.some((pattern) =>
      pattern.endsWith('*')
        ? name.startsWith(pattern.slice(0, -1))
        : name === pattern,
    );
  });
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = tools.get(name);
  if (!tool) return `Error: Unknown tool "${name}"`;
  try {
    return await tool.execute(args);
  } catch (err) {
    return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function hasTools(): boolean {
  return tools.size > 0;
}
