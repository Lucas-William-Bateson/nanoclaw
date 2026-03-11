/**
 * Glob tool: file pattern matching.
 * Uses Node.js fs.globSync (Node 22+) for zero-dependency globbing.
 */
import fs from 'fs';
import path from 'path';
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';
import { getBashCwd } from './bash.js';

const globTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'glob',
      description:
        'Find files matching a glob pattern. Returns paths sorted by modification time (newest first).',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js")',
          },
          path: {
            type: 'string',
            description: 'Directory to search in (default: working directory)',
          },
        },
        required: ['pattern'],
      },
    },
  },

  async execute(args) {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || getBashCwd();

    try {
      // Node 22 has fs.globSync
      const matches = fs.globSync(pattern, { cwd: searchPath });

      if (matches.length === 0) {
        return `No files matching "${pattern}" in ${searchPath}`;
      }

      // Sort by modification time (newest first)
      const withStats = matches
        .map((f) => {
          const fullPath = path.resolve(searchPath, f);
          try {
            return { path: fullPath, mtime: fs.statSync(fullPath).mtimeMs };
          } catch {
            return { path: fullPath, mtime: 0 };
          }
        })
        .sort((a, b) => b.mtime - a.mtime);

      return withStats.map((f) => f.path).join('\n');
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerTool(globTool);

export default globTool;
