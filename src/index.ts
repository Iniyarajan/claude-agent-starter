import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Agent } from './agent.js';

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('✗ Set ANTHROPIC_API_KEY first (see .env.example).');
    process.exit(1);
  }

  const agent = new Agent();
  const rl = createInterface({ input: stdin, output: stdout });

  console.log('claude-agent-starter — a tool-using AI agent.');
  console.log('Try:  "what is (12.5 * 8) + 3?"  ·  "what time is it in Tokyo?"  ·  "how does an agent loop work?"');
  console.log('Type "exit" to quit.\n');

  for (;;) {
    const input = (await rl.question('you › ')).trim();
    if (!input) continue;
    if (input === 'exit' || input === 'quit') break;

    try {
      const reply = await agent.send(input, (name, args) =>
        console.log(`   ↳ ${name}(${JSON.stringify(args)})`),
      );
      console.log(`\nagent › ${reply}\n`);
    } catch (err) {
      console.error(`\n[error] ${(err as Error).message}\n`);
    }
  }

  rl.close();
}

main();
