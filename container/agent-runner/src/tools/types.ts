/**
 * Shared types for the tool system.
 */
import type { PromptFunction } from '@copilot-extensions/preview-sdk';

export interface ToolImplementation {
  definition: PromptFunction;
  execute: (args: Record<string, unknown>) => Promise<string>;
}
