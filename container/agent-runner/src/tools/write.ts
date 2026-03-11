/**
 * Write tool: create or overwrite files.
 */
import fs from 'fs';
import path from 'path';
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';

const writeTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'write',
      description:
        'Write content to a file, creating parent directories if needed. Overwrites any existing file at the path.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to write',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['file_path', 'content'],
      },
    },
  },

  async execute(args) {
    const filePath = args.file_path as string;
    const content = args.content as string;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);

    const bytes = Buffer.byteLength(content, 'utf-8');
    return `File written: ${filePath} (${bytes} bytes)`;
  },
};

registerTool(writeTool);

export default writeTool;
