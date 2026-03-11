/**
 * WebFetch tool: fetch and extract text content from URLs.
 */
import type { ToolImplementation } from './types.js';
import { registerTool } from './index.js';

const MAX_OUTPUT = 50000;

/**
 * Minimal HTML-to-text: strip tags, decode entities, collapse whitespace.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const webFetchTool: ToolImplementation = {
  definition: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Fetch content from a URL and return it as text. HTML is converted to plain text. Use for reading web pages, API responses, etc.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch (must be fully-formed)',
          },
        },
        required: ['url'],
      },
    },
  },

  async execute(args) {
    const url = args.url as string;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'NanoClaw/1.0',
          Accept: 'text/html,application/json,text/plain,*/*',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get('content-type') || '';
      const body = await response.text();

      let text: string;
      if (contentType.includes('text/html')) {
        text = htmlToText(body);
      } else {
        text = body;
      }

      if (text.length > MAX_OUTPUT) {
        text = text.slice(0, MAX_OUTPUT) + '\n[content truncated]';
      }

      return text || '(empty response)';
    } catch (err) {
      return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

registerTool(webFetchTool);

export default webFetchTool;
