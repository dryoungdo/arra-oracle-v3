#!/usr/bin/env bun
/**
 * Minimal MCP client test — isolates whether the arra MCP hang
 * (glueboy-oracle#59) is in the codex CLI or in the arra MCP server.
 *
 * Spawns the arra MCP server as a subprocess, sends initialize + tools/call
 * arra_search over stdio, times each step. If this completes cleanly while
 * `codex review` hangs, the bug is codex-side. If this also hangs, the bug
 * is server-side.
 *
 * Usage:
 *   bun test/manual-mcp-client.ts
 *
 * Set ARRA_TEST_QUERY env to customize the search query (default "test query").
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_PATH = '/Users/dr.dosmacstudio/.codex/bin/arra-oracle-mcp.ts';
const QUERY = process.env.ARRA_TEST_QUERY ?? 'test query';
const STAGE_TIMEOUT_MS = 15_000;

function ts(): number { return Date.now(); }

async function withDeadline<T>(p: Promise<T>, label: string, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function main() {
  console.log('--- step 1: spawn server + create transport ---');
  const t0 = ts();
  const transport = new StdioClientTransport({
    command: '/Users/dr.dosmacstudio/.bun/bin/bun',
    args: [SERVER_PATH],
    env: {
      ...process.env,
      ORACLE_DATA_DIR: '/Users/dr.dosmacstudio/.arra-oracle-v2',
      ORACLE_EMBEDDING_MODEL: 'bge-m3',
      ORACLE_EMBEDDING_PROVIDER: 'ollama',
      ORACLE_VECTOR_DB: 'lancedb',
    },
  });
  const client = new Client({ name: 'manual-test-client', version: '1.0.0' }, { capabilities: {} });
  console.log(`[transport-create] ${ts() - t0}ms`);

  console.log('--- step 2: client.connect (initialize handshake) ---');
  const t1 = ts();
  await withDeadline(client.connect(transport), 'client.connect', STAGE_TIMEOUT_MS);
  console.log(`[connect] ${ts() - t1}ms`);

  console.log('--- step 3: list tools ---');
  const t2 = ts();
  const tools = await withDeadline(client.listTools(), 'listTools', STAGE_TIMEOUT_MS);
  console.log(`[listTools] ${ts() - t2}ms — ${tools.tools.length} tools`);
  const toolNames = tools.tools.map(t => t.name).filter(n => n.startsWith('arra_'));
  console.log(`  arra tools: ${toolNames.join(', ')}`);

  console.log('--- step 4: call arra_search ---');
  const t3 = ts();
  const result = await withDeadline(
    client.callTool({ name: 'arra_search', arguments: { query: QUERY, limit: 3 } }),
    'callTool(arra_search)',
    STAGE_TIMEOUT_MS,
  );
  console.log(`[callTool arra_search] ${ts() - t3}ms`);
  const content = (result as any).content;
  if (Array.isArray(content) && content[0]?.type === 'text') {
    const text = content[0].text;
    console.log(`  response (first 200 chars): ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
  } else {
    console.log(`  response: ${JSON.stringify(result).substring(0, 200)}`);
  }

  console.log('--- step 5: close ---');
  const t4 = ts();
  await client.close();
  console.log(`[close] ${ts() - t4}ms`);

  console.log(`\n=== TOTAL: ${ts() - t0}ms ===`);
  console.log('OK — if this completes cleanly while codex review hangs, the bug is in the codex CLI.');
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
