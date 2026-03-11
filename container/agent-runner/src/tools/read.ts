/**
 * Read tool: read files with line numbers (cat -n style).
 */
import fs from 'fs';
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

const readTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'read',
      description:
        'Read a file from the filesystem. Returns contents with line numbers. Supports offset and limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to read',
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-based)',
          },
          limit: {
            type: 'number',
            description: 'Number of lines to read (default 2000)',
          },
        },
        required: ['file_path'],
      },
    },
  },

  async execute(args) {
    const filePath = args.file_path as string;
    const offset = Math.max(1, (args.offset as number) || 1);
    const limit = (args.limit as number) || DEFAULT_LIMIT;

    if (!fs.existsSync(filePath)) {
      return `Error: File not found: ${filePath}`;
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return `Error: ${filePath} is a directory, not a file. Use bash with ls to list directory contents.`;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const allLines = content.split('\n');
    const selectedLines = allLines.slice(offset - 1, offset - 1 + limit);

    const formatted = selectedLines
      .map((line, i) => {
        const lineNum = offset + i;
        const truncated =
          line.length > MAX_LINE_LENGTH
            ? line.slice(0, MAX_LINE_LENGTH) + '...'
            : line;
        return `${String(lineNum).padStart(6, ' ')}\t${truncated}`;
      })
      .join('\n');

    const header =
      allLines.length > limit
        ? `[Showing lines ${offset}-${offset + selectedLines.length - 1} of ${allLines.length}]\n`
        : '';

    return header + formatted;
  },
};

registerTool(readTool);

export default readTool;
