/**
 * NanoClaw IPC tools: direct implementations of NanoClaw-specific tools.
 * Extracted from ipc-mcp-stdio.ts — writes JSON files to IPC directories
 * instead of going through MCP protocol.
 */
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// Context set at init time from ContainerInput
let chatJid = '';
let groupFolder = '';
let isMain = false;

export function initNanoClawContext(opts: {
  chatJid: string;
  groupFolder: string;
  isMain: boolean;
}): void {
  chatJid = opts.chatJid;
  groupFolder = opts.groupFolder;
  isMain = opts.isMain;
}

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);
  return filename;
}

// --- send_message ---
const sendMessageTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'nanoclaw_send_message',
      description:
        "Send a message to the user or group immediately while you're still running. Use for progress updates or to send multiple messages.",
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The message text to send' },
          sender: {
            type: 'string',
            description:
              'Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.',
          },
        },
        required: ['text'],
      },
    },
  },
  async execute(args) {
    writeIpcFile(MESSAGES_DIR, {
      type: 'message',
      chatJid,
      text: args.text as string,
      sender: (args.sender as string) || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    });
    return 'Message sent.';
  },
};

// --- schedule_task ---
const scheduleTaskTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'nanoclaw_schedule_task',
      description: `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE:
- "group": Task runs with chat history. Use for tasks needing conversation context.
- "isolated": Task runs fresh. Include all context in the prompt.

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
- cron: Standard cron (e.g., "0 9 * * *" for daily at 9am)
- interval: Milliseconds (e.g., "300000" for 5 minutes)
- once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00")`,
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'What the agent should do when the task runs',
          },
          schedule_type: {
            type: 'string',
            enum: ['cron', 'interval', 'once'],
            description: 'Schedule type',
          },
          schedule_value: {
            type: 'string',
            description: 'Schedule value',
          },
          context_mode: {
            type: 'string',
            enum: ['group', 'isolated'],
            description: 'Context mode (default: group)',
          },
          target_group_jid: {
            type: 'string',
            description:
              '(Main group only) JID of the group to schedule the task for',
          },
        },
        required: ['prompt', 'schedule_type', 'schedule_value'],
      },
    },
  },
  async execute(args) {
    const scheduleType = args.schedule_type as string;
    const scheduleValue = args.schedule_value as string;

    // Validate schedule_value
    if (scheduleType === 'cron') {
      try {
        CronExpressionParser.parse(scheduleValue);
      } catch {
        return `Error: Invalid cron: "${scheduleValue}". Use format like "0 9 * * *".`;
      }
    } else if (scheduleType === 'interval') {
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) {
        return `Error: Invalid interval: "${scheduleValue}". Must be positive milliseconds.`;
      }
    } else if (scheduleType === 'once') {
      if (
        /[Zz]$/.test(scheduleValue) ||
        /[+-]\d{2}:\d{2}$/.test(scheduleValue)
      ) {
        return `Error: Timestamp must be local time without timezone suffix. Got "${scheduleValue}".`;
      }
      if (isNaN(new Date(scheduleValue).getTime())) {
        return `Error: Invalid timestamp: "${scheduleValue}".`;
      }
    }

    const targetJid =
      isMain && (args.target_group_jid as string)
        ? (args.target_group_jid as string)
        : chatJid;
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    writeIpcFile(TASKS_DIR, {
      type: 'schedule_task',
      taskId,
      prompt: args.prompt as string,
      schedule_type: scheduleType,
      schedule_value: scheduleValue,
      context_mode: (args.context_mode as string) || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    });

    return `Task ${taskId} scheduled: ${scheduleType} - ${scheduleValue}`;
  },
};

// --- list_tasks ---
const listTasksTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'nanoclaw_list_tasks',
      description:
        "List all scheduled tasks. Main sees all; others see only their own group's tasks.",
      parameters: { type: 'object', properties: {} },
    },
  },
  async execute() {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');
    if (!fs.existsSync(tasksFile)) return 'No scheduled tasks found.';

    try {
      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
      const tasks = isMain
        ? allTasks
        : allTasks.filter(
            (t: { groupFolder: string }) => t.groupFolder === groupFolder,
          );
      if (tasks.length === 0) return 'No scheduled tasks found.';

      return (
        'Scheduled tasks:\n' +
        tasks
          .map(
            (t: {
              id: string;
              prompt: string;
              schedule_type: string;
              schedule_value: string;
              status: string;
              next_run: string;
            }) =>
              `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
          )
          .join('\n')
      );
    } catch (err) {
      return `Error reading tasks: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

// --- pause_task ---
const pauseTaskTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'nanoclaw_pause_task',
      description: 'Pause a scheduled task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The task ID to pause' },
        },
        required: ['task_id'],
      },
    },
  },
  async execute(args) {
    writeIpcFile(TASKS_DIR, {
      type: 'pause_task',
      taskId: args.task_id as string,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    });
    return `Task ${args.task_id} pause requested.`;
  },
};

// --- resume_task ---
const resumeTaskTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'nanoclaw_resume_task',
      description: 'Resume a paused task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The task ID to resume' },
        },
        required: ['task_id'],
      },
    },
  },
  async execute(args) {
    writeIpcFile(TASKS_DIR, {
      type: 'resume_task',
      taskId: args.task_id as string,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    });
    return `Task ${args.task_id} resume requested.`;
  },
};

// --- cancel_task ---
const cancelTaskTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'nanoclaw_cancel_task',
      description: 'Cancel and delete a scheduled task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The task ID to cancel' },
        },
        required: ['task_id'],
      },
    },
  },
  async execute(args) {
    writeIpcFile(TASKS_DIR, {
      type: 'cancel_task',
      taskId: args.task_id as string,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    });
    return `Task ${args.task_id} cancellation requested.`;
  },
};

// --- update_task ---
const updateTaskTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'nanoclaw_update_task',
      description:
        'Update an existing scheduled task. Only provided fields are changed.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The task ID to update' },
          prompt: { type: 'string', description: 'New prompt for the task' },
          schedule_type: {
            type: 'string',
            enum: ['cron', 'interval', 'once'],
            description: 'New schedule type',
          },
          schedule_value: {
            type: 'string',
            description: 'New schedule value',
          },
        },
        required: ['task_id'],
      },
    },
  },
  async execute(args) {
    const scheduleType = args.schedule_type as string | undefined;
    const scheduleValue = args.schedule_value as string | undefined;

    // Validate if provided
    if (scheduleType === 'cron' && scheduleValue) {
      try {
        CronExpressionParser.parse(scheduleValue);
      } catch {
        return `Error: Invalid cron: "${scheduleValue}".`;
      }
    }
    if (scheduleType === 'interval' && scheduleValue) {
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) {
        return `Error: Invalid interval: "${scheduleValue}".`;
      }
    }

    const data: Record<string, string | boolean> = {
      type: 'update_task',
      taskId: args.task_id as string,
      groupFolder,
      isMain: String(isMain),
      timestamp: new Date().toISOString(),
    };
    if (args.prompt !== undefined) data.prompt = args.prompt as string;
    if (scheduleType !== undefined) data.schedule_type = scheduleType;
    if (scheduleValue !== undefined) data.schedule_value = scheduleValue;

    writeIpcFile(TASKS_DIR, data);
    return `Task ${args.task_id} update requested.`;
  },
};

// --- register_group ---
const registerGroupTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'nanoclaw_register_group',
      description:
        'Register a new chat/group so the agent can respond there. Main group only. Folder must be channel-prefixed: "{channel}_{group-name}".',
      parameters: {
        type: 'object',
        properties: {
          jid: { type: 'string', description: 'The chat JID' },
          name: { type: 'string', description: 'Display name for the group' },
          folder: {
            type: 'string',
            description:
              'Channel-prefixed folder name (e.g., "whatsapp_family-chat")',
          },
          trigger: {
            type: 'string',
            description: 'Trigger word (e.g., "@Andy")',
          },
        },
        required: ['jid', 'name', 'folder', 'trigger'],
      },
    },
  },
  async execute(args) {
    if (!isMain) {
      return 'Error: Only the main group can register new groups.';
    }

    writeIpcFile(TASKS_DIR, {
      type: 'register_group',
      jid: args.jid as string,
      name: args.name as string,
      folder: args.folder as string,
      trigger: args.trigger as string,
      timestamp: new Date().toISOString(),
    });

    return `Group "${args.name}" registered. It will start receiving messages immediately.`;
  },
};

// Register all tools
registerTool(sendMessageTool);
registerTool(scheduleTaskTool);
registerTool(listTasksTool);
registerTool(pauseTaskTool);
registerTool(resumeTaskTool);
registerTool(cancelTaskTool);
registerTool(updateTaskTool);
registerTool(registerGroupTool);
