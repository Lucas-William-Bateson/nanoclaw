/**
 * NotebookEdit tool: edit Jupyter notebook cells.
 */
import fs from 'fs';
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';

interface NotebookCell {
  cell_type: string;
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

const notebookEditTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'notebook_edit',
      description:
        'Edit a Jupyter notebook (.ipynb) cell. Can replace, insert, or delete cells.',
      parameters: {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description: 'Absolute path to the .ipynb file',
          },
          cell_number: {
            type: 'number',
            description: 'Cell index (0-based)',
          },
          new_source: {
            type: 'string',
            description: 'New source content for the cell',
          },
          cell_type: {
            type: 'string',
            enum: ['code', 'markdown'],
            description: 'Cell type (required for insert)',
          },
          edit_mode: {
            type: 'string',
            enum: ['replace', 'insert', 'delete'],
            description: 'Edit mode (default: replace)',
          },
        },
        required: ['notebook_path', 'new_source'],
      },
    },
  },

  async execute(args) {
    const notebookPath = args.notebook_path as string;
    const cellNumber = (args.cell_number as number) ?? 0;
    const newSource = args.new_source as string;
    const cellType = (args.cell_type as string) || 'code';
    const editMode = (args.edit_mode as string) || 'replace';

    if (!fs.existsSync(notebookPath)) {
      return `Error: Notebook not found: ${notebookPath}`;
    }

    const notebook: Notebook = JSON.parse(
      fs.readFileSync(notebookPath, 'utf-8'),
    );

    const sourceLines = newSource
      .split('\n')
      .map((line, i, arr) => (i < arr.length - 1 ? line + '\n' : line));

    switch (editMode) {
      case 'insert': {
        const newCell: NotebookCell = {
          cell_type: cellType,
          source: sourceLines,
          metadata: {},
          ...(cellType === 'code'
            ? { outputs: [], execution_count: null }
            : {}),
        };
        notebook.cells.splice(cellNumber, 0, newCell);
        break;
      }
      case 'delete':
        if (cellNumber >= notebook.cells.length) {
          return `Error: Cell index ${cellNumber} out of range (${notebook.cells.length} cells)`;
        }
        notebook.cells.splice(cellNumber, 1);
        break;
      case 'replace':
      default:
        if (cellNumber >= notebook.cells.length) {
          return `Error: Cell index ${cellNumber} out of range (${notebook.cells.length} cells)`;
        }
        notebook.cells[cellNumber].source = sourceLines;
        if (notebook.cells[cellNumber].cell_type === 'code') {
          notebook.cells[cellNumber].outputs = [];
          notebook.cells[cellNumber].execution_count = null;
        }
        break;
    }

    fs.writeFileSync(notebookPath, JSON.stringify(notebook, null, 1) + '\n');
    return `Notebook ${editMode}d cell ${cellNumber} in ${notebookPath}`;
  },
};

registerTool(notebookEditTool);

export default notebookEditTool;
