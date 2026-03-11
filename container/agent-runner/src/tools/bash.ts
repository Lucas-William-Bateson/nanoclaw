/**
 * Bash tool: execute shell commands inside the container.
 */
import { exec } from 'child_process';
import path from 'path';
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';

const MAX_OUTPUT = 30000;
const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;

let cwd = '/workspace/group';

export function setBashCwd(dir: string): void {
  cwd = dir;
}

export function getBashCwd(): string {
  return cwd;
}

const bashTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'bash',
      description:
        'Execute a bash command in the container. Use for git, npm, docker, and other terminal operations. Prefer dedicated tools (read, write, edit, glob, grep) for file operations.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (max 600000, default 120000)',
          },
        },
        required: ['command'],
      },
    },
  },

  async execute(args) {
    const command = args.command as string;
    const timeout = Math.min(
      (args.timeout as number) || DEFAULT_TIMEOUT,
      MAX_TIMEOUT,
    );

    return new Promise<string>((resolve) => {
      // Run within current working directory
      exec(
        command,
        {
          cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          shell: '/bin/bash',
        },
        (error, stdout, stderr) => {
          // Track cd commands to persist working directory
          const cdMatch = command.match(/^\s*cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)/);
          if (cdMatch && !error) {
            const target = cdMatch[1].replace(/^["']|["']$/g, '');
            cwd = path.resolve(cwd, target);
          }

          let output = '';
          if (stdout) output += stdout;
          if (stderr) output += (output ? '\n' : '') + stderr;
          if (error && 'code' in error && error.code) {
            output += `\nExit code: ${error.code}`;
          }

          if (output.length > MAX_OUTPUT) {
            output = output.slice(0, MAX_OUTPUT) + '\n[output truncated]';
          }

          resolve(output || '(no output)');
        },
      );
    });
  },
};

registerTool(bashTool);

export default bashTool;
