/**
 * Edit tool: find-and-replace string editing.
 */
import fs from 'fs';
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';

const editTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'edit',
      description:
        'Edit a file by replacing a specific string with new content. The old_string must be unique in the file. Use replace_all to replace every occurrence.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to edit',
          },
          old_string: {
            type: 'string',
            description: 'The exact text to find and replace',
          },
          new_string: {
            type: 'string',
            description: 'The replacement text',
          },
          replace_all: {
            type: 'boolean',
            description:
              'Replace all occurrences (default false — fails if old_string is not unique)',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },

  async execute(args) {
    const filePath = args.file_path as string;
    const oldString = args.old_string as string;
    const newString = args.new_string as string;
    const replaceAll = (args.replace_all as boolean) || false;

    if (!fs.existsSync(filePath)) {
      return `Error: File not found: ${filePath}`;
    }

    if (oldString === newString) {
      return 'Error: old_string and new_string are identical';
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Count occurrences
    let count = 0;
    let idx = 0;
    while ((idx = content.indexOf(oldString, idx)) !== -1) {
      count++;
      idx += oldString.length;
    }

    if (count === 0) {
      return `Error: old_string not found in ${filePath}`;
    }

    if (count > 1 && !replaceAll) {
      return `Error: old_string found ${count} times in ${filePath}. Provide more context to make it unique, or set replace_all=true.`;
    }

    let newContent: string;
    if (replaceAll) {
      newContent = content.split(oldString).join(newString);
    } else {
      const pos = content.indexOf(oldString);
      newContent =
        content.slice(0, pos) +
        newString +
        content.slice(pos + oldString.length);
    }

    fs.writeFileSync(filePath, newContent);
    return `Edited ${filePath}: replaced ${replaceAll ? count + ' occurrences' : '1 occurrence'}`;
  },
};

registerTool(editTool);

export default editTool;
