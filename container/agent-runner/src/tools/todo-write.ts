/**
 * TodoWrite tool: in-memory task tracking within a session.
 */
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

let todos: TodoItem[] = [];

export function getTodos(): TodoItem[] {
  return todos;
}

const todoWriteTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'todo_write',
      description:
        'Create and manage a task list for tracking progress. Use to plan multi-step tasks and show progress to the user.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The updated todo list',
            items: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'Task description (imperative form)',
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                },
                activeForm: {
                  type: 'string',
                  description:
                    'Present continuous form (e.g., "Running tests")',
                },
              },
              required: ['content', 'status', 'activeForm'],
            },
          },
        },
        required: ['todos'],
      },
    },
  },

  async execute(args) {
    const newTodos = args.todos as TodoItem[];
    todos = newTodos;

    const summary = todos
      .map((t) => {
        const icon =
          t.status === 'completed'
            ? '[x]'
            : t.status === 'in_progress'
              ? '[>]'
              : '[ ]';
        return `${icon} ${t.content}`;
      })
      .join('\n');

    return `Todo list updated:\n${summary}`;
  },
};

registerTool(todoWriteTool);

export default todoWriteTool;
