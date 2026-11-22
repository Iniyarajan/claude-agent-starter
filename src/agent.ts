import Anthropic from '@anthropic-ai/sdk';
import { tools, findTool } from './tools.js';

/** Model is overridable via the MODEL env var; defaults to the current Opus. */
const MODEL = process.env.MODEL ?? 'claude-opus-5-5';
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are a concise, helpful assistant with access to tools.
When a user asks for arithmetic, the current time, or background on how agents and
the Claude API work, call the appropriate tool rather than answering from memory.
Keep replies short and direct.`;

export type ToolCallListener = (name: string, input: unknown) => void;

/**
 * A minimal tool-using agent.
 *
 * `send()` runs the full agentic loop for one user turn: it calls the model, and
 * while the model asks to use tools, it executes them, feeds the results back,
 * and calls the model again — stopping only when the model returns a final answer.
 */
export class Agent {
  private readonly client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  private readonly messages: Anthropic.MessageParam[] = [];

  async send(userInput: string, onToolCall?: ToolCallListener): Promise<string> {
    this.messages.push({ role: 'user', content: userInput });

    // The agentic loop.
    while (true) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: tools.map((t) => t.definition),
        messages: this.messages,
      });

      // Preserve the entire assistant turn (text + any thinking + tool_use blocks)
      // unchanged, so the next request carries valid context.
      this.messages.push({ role: 'assistant', content: response.content });

      // No tool requested → this is the final answer.
      if (response.stop_reason !== 'tool_use') {
        return textOf(response.content);
      }

      // Execute every tool the model requested this turn. All tool_result blocks
      // must go back in a SINGLE user message (required for parallel tool use).
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        onToolCall?.(block.name, block.input);

        const tool = findTool(block.name);
        let content: string;
        let isError = false;
        try {
          if (!tool) {
            content = `Unknown tool: ${block.name}`;
            isError = true;
          } else {
            content = await tool.execute(block.input as Record<string, unknown>);
          }
        } catch (err) {
          content = `Error: ${(err as Error).message}`;
          isError = true;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content,
          is_error: isError,
        });
      }

      this.messages.push({ role: 'user', content: toolResults });
    }
  }
}

/** Collect the plain-text parts of an assistant response. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
