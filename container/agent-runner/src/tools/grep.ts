/**
 * Grep tool: content search via ripgrep (rg) CLI.
 */
import { execSync } from 'child_process';
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';
import { getBashCwd } from './bash.js';

const MAX_OUTPUT = 30000;

const grepTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'grep',
      description:
        'Search file contents using regex patterns. Built on ripgrep. Defaults to showing file paths with matches.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for',
          },
          path: {
            type: 'string',
            description:
              'File or directory to search in (default: working directory)',
          },
          glob: {
            type: 'string',
            description:
              'Glob pattern to filter files (e.g., "*.ts", "**/*.tsx")',
          },
          type: {
            type: 'string',
            description: 'File type to search (e.g., "js", "py", "ts")',
          },
          output_mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
            description:
              'Output mode: content shows matching lines, files_with_matches shows file paths (default), count shows match counts',
          },
          context: {
            type: 'number',
            description:
              'Lines of context around each match (for content mode)',
          },
          case_insensitive: {
            type: 'boolean',
            description: 'Case insensitive search',
          },
          head_limit: {
            type: 'number',
            description: 'Limit output to first N entries',
          },
        },
        required: ['pattern'],
      },
    },
  },

  async execute(args) {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || getBashCwd();
    const outputMode = (args.output_mode as string) || 'files_with_matches';
    const context = args.context as number | undefined;
    const caseInsensitive = args.case_insensitive as boolean | undefined;
    const globPattern = args.glob as string | undefined;
    const fileType = args.type as string | undefined;
    const headLimit = args.head_limit as number | undefined;

    const rgArgs: string[] = ['rg'];

    // Output mode flags
    switch (outputMode) {
      case 'files_with_matches':
        rgArgs.push('-l');
        break;
      case 'count':
        rgArgs.push('-c');
        break;
      case 'content':
        rgArgs.push('-n'); // Show line numbers
        if (context) rgArgs.push('-C', String(context));
        break;
    }

    if (caseInsensitive) rgArgs.push('-i');
    if (globPattern) rgArgs.push('--glob', globPattern);
    if (fileType) rgArgs.push('--type', fileType);

    rgArgs.push('--', pattern, searchPath);

    try {
      let output = execSync(rgArgs.join(' '), {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      });

      if (headLimit && headLimit > 0) {
        const lines = output.split('\n');
        output = lines.slice(0, headLimit).join('\n');
      }

      if (output.length > MAX_OUTPUT) {
        output = output.slice(0, MAX_OUTPUT) + '\n[output truncated]';
      }

      return output.trim() || 'No matches found';
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err) {
        const exitCode = (err as { status: number }).status;
        // rg exits 1 when no matches found
        if (exitCode === 1) return 'No matches found';
      }
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerTool(grepTool);

export default grepTool;
