#!/usr/bin/env node
// dsh-memento stdio MCP server launcher. Reads the memory database read-only
// and serves memory_search / memory_stats over newline-delimited JSON-RPC 2.0
// on stdio. No harness, no network, no write path — the database is opened
// with node:sqlite readOnly:true and a missing file yields empty results.
//
// Database path: $DSH_MEMENTO_DB_PATH (absolute, or relative to $DSH_HOME);
// defaults to $DSH_HOME/dsh-memento/memory.db (falls back to ~/.dsh).
import { readFileSync } from 'node:fs'
import { resolveDbPath } from '../lib/store.mjs'
import { createMcpServer, ReadOnlyMemoryStore, runStdioServer } from '../lib/mcp.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const dbPath = resolveDbPath(process.env.DSH_MEMENTO_DB_PATH ?? '')
const store = new ReadOnlyMemoryStore(dbPath)
const server = createMcpServer({ store, version: pkg.version })

runStdioServer(server)
