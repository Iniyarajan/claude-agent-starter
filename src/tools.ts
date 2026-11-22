import type Anthropic from '@anthropic-ai/sdk';

/**
 * A Tool pairs a Claude tool *definition* (the JSON schema the model sees) with
 * a local *executor* (the code that actually runs when the model calls it).
 *
 * The model never runs code itself — it asks the client to run a named tool
 * with arguments, and reads the result back as a `tool_result`.
 */
export interface Tool {
  definition: Anthropic.Tool;
  execute(input: Record<string, unknown>): Promise<string> | string;
}

/* ------------------------------------------------------------------ */
/* calculator — a safe arithmetic evaluator (no eval / no Function)    */
/* ------------------------------------------------------------------ */

/** Recursive-descent parser for `+ - * /` and parentheses over decimals. */
class Calc {
  private pos = 0;
  private constructor(private readonly s: string) {}

  static evaluate(expr: string): number {
    const c = new Calc(expr.replace(/\s+/g, ''));
    const value = c.expr();
    if (c.pos !== c.s.length) throw new Error(`Unexpected character at position ${c.pos}`);
    return value;
  }

  private expr(): number {
    let v = this.term();
    while (this.s[this.pos] === '+' || this.s[this.pos] === '-') {
      const op = this.s[this.pos++];
      const rhs = this.term();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }

  private term(): number {
    let v = this.factor();
    while (this.s[this.pos] === '*' || this.s[this.pos] === '/') {
      const op = this.s[this.pos++];
      const rhs = this.factor();
      if (op === '/' && rhs === 0) throw new Error('Division by zero');
      v = op === '*' ? v * rhs : v / rhs;
    }
    return v;
  }

  private factor(): number {
    if (this.s[this.pos] === '(') {
      this.pos++;
      const v = this.expr();
      if (this.s[this.pos] !== ')') throw new Error('Missing closing parenthesis');
      this.pos++;
      return v;
    }
    if (this.s[this.pos] === '-') {
      this.pos++;
      return -this.factor();
    }
    const start = this.pos;
    while (/[0-9.]/.test(this.s[this.pos] ?? '')) this.pos++;
    const num = this.s.slice(start, this.pos);
    if (!num) throw new Error(`Expected a number at position ${this.pos}`);
    return parseFloat(num);
  }
}

const calculator: Tool = {
  definition: {
    name: 'calculator',
    description:
      'Evaluate a basic arithmetic expression (+, -, *, /, parentheses). ' +
      'Use this for any math instead of computing it yourself.',
    input_schema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'e.g. "(3 + 4) * 2 / 7"' },
      },
      required: ['expression'],
    },
  },
  execute(input) {
    const expression = String(input.expression ?? '');
    return `${expression} = ${Calc.evaluate(expression)}`;
  },
};

/* ------------------------------------------------------------------ */
/* current_time                                                        */
/* ------------------------------------------------------------------ */

const currentTime: Tool = {
  definition: {
    name: 'current_time',
    description:
      'Get the current date and time, optionally in a specific IANA timezone ' +
      '(e.g. "Asia/Kolkata", "America/New_York", "UTC").',
    input_schema: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: 'IANA timezone name; defaults to the host timezone.' },
      },
      required: [],
    },
  },
  execute(input) {
    const timeZone = input.timezone ? String(input.timezone) : undefined;
    try {
      return new Date().toLocaleString('en-US', { timeZone, dateStyle: 'full', timeStyle: 'long' });
    } catch {
      return `Unknown timezone: ${timeZone}`;
    }
  },
};

/* ------------------------------------------------------------------ */
/* search_knowledge_base — a tiny in-memory retrieval example (RAG)    */
/* ------------------------------------------------------------------ */

const KNOWLEDGE_BASE: { topic: string; content: string }[] = [
  {
    topic: 'agent loop',
    content:
      'An agent loop sends the conversation to the model; if the model returns tool_use blocks, ' +
      'the client executes them, appends tool_result blocks, and calls the model again — repeating ' +
      'until the model stops requesting tools.',
  },
  {
    topic: 'tool use',
    content:
      'A tool is a JSON-schema function the model can call. The model never runs code itself; it asks ' +
      'the client to run a named tool with arguments, and reads the result back as a tool_result.',
  },
  {
    topic: 'claude messages api',
    content:
      'Anthropic Claude models are called via POST /v1/messages. Tools and structured outputs are ' +
      'features of that single endpoint, not separate APIs.',
  },
  {
    topic: 'this project',
    content:
      'claude-agent-starter is a minimal reference implementation of a tool-using agent in TypeScript, ' +
      'written to be read and learned from.',
  },
];

const searchKnowledgeBase: Tool = {
  definition: {
    name: 'search_knowledge_base',
    description:
      'Search the local knowledge base for background on agents, tool use, the Claude API, and this ' +
      'project. Returns the most relevant entries.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look up.' },
      },
      required: ['query'],
    },
  },
  execute(input) {
    const terms = String(input.query ?? '')
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean);

    const hits = KNOWLEDGE_BASE.map((entry) => {
      const haystack = `${entry.topic} ${entry.content}`.toLowerCase();
      const score = terms.reduce((n, t) => n + (haystack.includes(t) ? 1 : 0), 0);
      return { entry, score };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    if (hits.length === 0) return 'No matching entries found.';
    return hits.map((x) => `• ${x.entry.topic}: ${x.entry.content}`).join('\n');
  },
};

/** Every tool the agent can use. Add to this array to give the agent new abilities. */
export const tools: Tool[] = [calculator, currentTime, searchKnowledgeBase];

/** Look up a tool by the name the model used. */
export function findTool(name: string): Tool | undefined {
  return tools.find((t) => t.definition.name === name);
}
