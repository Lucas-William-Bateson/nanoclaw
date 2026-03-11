/**
 * Build the system prompt from CLAUDE.md files and context.
 */
import fs from 'fs';
import path from 'path';

export interface SystemPromptOptions {
  assistantName?: string;
  isMain: boolean;
  chatJid: string;
  groupFolder: string;
  timezone: string;
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const parts: string[] = [];

  parts.push(
    `You are ${options.assistantName || 'a helpful assistant'}, running inside a NanoClaw container agent.`,
  );
  parts.push(`Current date: ${new Date().toISOString().split('T')[0]}`);
  parts.push(`Timezone: ${options.timezone}`);
  parts.push(`Working directory: /workspace/group`);
  parts.push('');

  // Load group CLAUDE.md
  const groupClaudeMd = '/workspace/group/CLAUDE.md';
  if (fs.existsSync(groupClaudeMd)) {
    parts.push('## Group Memory (CLAUDE.md)');
    parts.push(fs.readFileSync(groupClaudeMd, 'utf-8'));
    parts.push('');
  }

  // Load global CLAUDE.md (non-main groups only)
  if (!options.isMain) {
    const globalClaudeMd = '/workspace/global/CLAUDE.md';
    if (fs.existsSync(globalClaudeMd)) {
      parts.push('## Global Memory');
      parts.push(fs.readFileSync(globalClaudeMd, 'utf-8'));
      parts.push('');
    }
  }

  // Load CLAUDE.md from additional mounted directories
  const extraBase = '/workspace/extra';
  if (fs.existsSync(extraBase)) {
    for (const entry of fs.readdirSync(extraBase)) {
      const extraDir = path.join(extraBase, entry);
      const extraClaudeMd = path.join(extraDir, 'CLAUDE.md');
      if (fs.statSync(extraDir).isDirectory() && fs.existsSync(extraClaudeMd)) {
        parts.push(`## Additional Context (${entry})`);
        parts.push(fs.readFileSync(extraClaudeMd, 'utf-8'));
        parts.push('');
      }
    }
  }

  // Load skills
  const skillsDir = '/home/node/.claude/skills';
  if (fs.existsSync(skillsDir)) {
    for (const skillDir of fs.readdirSync(skillsDir)) {
      const skillMd = path.join(skillsDir, skillDir, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        parts.push(`## Skill: ${skillDir}`);
        parts.push(fs.readFileSync(skillMd, 'utf-8'));
        parts.push('');
      }
    }
  }

  // Tool usage guidelines
  parts.push('## Tool Usage Guidelines');
  parts.push(
    '- Execute tools proactively. Do not tell the user to run commands — run them yourself.',
  );
  parts.push(
    '- Use the bash tool for shell operations (git, npm, docker, etc.).',
  );
  parts.push(
    '- Use read/write/edit for file operations (preferred over bash cat/sed/echo).',
  );
  parts.push('- Use glob for finding files, grep for searching content.');
  parts.push(
    '- Use nanoclaw_send_message to send intermediate messages to the user while working.',
  );
  parts.push(
    '- Wrap internal reasoning in <internal>...</internal> tags to suppress it from user output.',
  );
  parts.push(
    '- Only make changes that are directly requested. Keep solutions simple and focused.',
  );
  parts.push(
    '- NEVER propose changes to code you have not read. Read files before modifying them.',
  );

  if (options.isMain) {
    parts.push('');
    parts.push('## Main Group Privileges');
    parts.push(
      '- You are running in the MAIN group and have admin privileges.',
    );
    parts.push('- You can schedule tasks for any group and manage all tasks.');
    parts.push('- You can register new groups.');
  }

  return parts.join('\n');
}
