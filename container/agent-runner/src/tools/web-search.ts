/**
 * WebSearch tool: web search via agent-browser (installed globally in container).
 */
import { execSync } from 'child_process';
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';

const webSearchTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web using a query string. Returns search results with titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
        },
        required: ['query'],
      },
    },
  },

  async execute(args) {
    const query = args.query as string;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    try {
      // Use agent-browser which is installed globally in the container
      const result = execSync(
        `agent-browser open "${searchUrl}" && sleep 2 && agent-browser snapshot`,
        {
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 5 * 1024 * 1024,
        },
      );

      return result.trim() || 'No search results found';
    } catch (err) {
      // Fallback: try fetching the search page directly
      try {
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NanoClaw/1.0)',
          },
          signal: AbortSignal.timeout(15_000),
        });
        const html = await response.text();
        // Extract text content from search results
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return text.slice(0, 30000) || 'No results found';
      } catch {
        return `Error searching: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  },
};

registerTool(webSearchTool);

export default webSearchTool;
