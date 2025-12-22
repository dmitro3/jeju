/**
 * A2A Server for network Documentation
 * Enables agents to search and query documentation programmatically
 */

import express from 'express';
import cors from 'cors';
import { readFile, stat, realpath } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { getNetworkName } from '@jejunetwork/config';
import { searchDocumentation, listTopics, DOCS_ROOT, type SearchResult, type Topic } from '../lib/a2a';

const PORT = process.env.DOCUMENTATION_A2A_PORT || 7778;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB max file size
const MAX_JSON_BODY_SIZE = '100kb';
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;

// Rate limiting state (simple in-memory implementation)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function getRateLimitKey(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(req: express.Request): boolean {
  const key = getRateLimitKey(req);
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  entry.count++;
  return true;
}

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

// Allowed origins for CORS (production should be more restrictive)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:4004',
  'http://localhost:3000',
  'https://docs.jejunetwork.org',
  'https://jejunetwork.org',
];

const SkillParamsSchema = z.record(z.string(), z.string());

const SkillDataSchema = z.object({
  skillId: z.string(),
  params: SkillParamsSchema.optional(),
});

const A2AMessagePartSchema = z.object({
  kind: z.string(),
  text: z.string().optional(),
  data: SkillDataSchema.optional(),
});

const A2AMessageSchema = z.object({
  messageId: z.string(),
  parts: z.array(A2AMessagePartSchema),
});

const A2ARequestSchema = z.object({
  jsonrpc: z.string(),
  method: z.string(),
  params: z.object({
    message: A2AMessageSchema.optional(),
  }).optional(),
  id: z.union([z.number(), z.string()]),
});

interface SkillResult {
  message: string;
  data: Record<string, string | number | SearchResult[] | Topic[]>;
}

const app = express();

// CORS with explicit origin validation
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl or server-to-server)
    if (!origin) {
      callback(null, true);
      return;
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// JSON body parsing with size limit to prevent DoS
app.use(express.json({ limit: MAX_JSON_BODY_SIZE }));

// Rate limiting middleware
app.use((req, res, next) => {
  if (!checkRateLimit(req)) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
});

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: `${getNetworkName()} Documentation`,
  description: 'Search and query the network documentation programmatically',
  url: `http://localhost:${PORT}/api/a2a`,
  preferredTransport: 'http',
  provider: { organization: 'the network', url: 'https://jejunetwork.org' },
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    {
      id: 'search-docs',
      name: 'Search Documentation',
      description: 'Search documentation for keywords or topics',
      tags: ['query', 'search', 'documentation'],
      examples: ['Search for oracle', 'Find information about paymasters'],
    },
    {
      id: 'get-page',
      name: 'Get Documentation Page',
      description: 'Retrieve content of a specific documentation page',
      tags: ['query', 'documentation'],
      examples: ['Get contract documentation', 'Show deployment guide'],
    },
    {
      id: 'list-topics',
      name: 'List Documentation Topics',
      description: 'Get organized list of documentation topics',
      tags: ['query', 'navigation'],
      examples: ['List all topics', 'Documentation structure'],
    },
  ],
} as const;

app.get('/.well-known/agent-card.json', (_req, res) => res.json(AGENT_CARD));

app.post('/api/a2a', async (req, res) => {
  const parseResult = A2ARequestSchema.safeParse(req.body);
  
  if (!parseResult.success) {
    res.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request format' } });
    return;
  }

  const { method, params, id } = parseResult.data;
  const error = (code: number, message: string) =>
    res.json({ jsonrpc: '2.0', id, error: { code, message } });

  if (method !== 'message/send') {
    error(-32601, 'Method not found');
    return;
  }

  const message = params?.message;
  if (!message?.parts) {
    error(-32602, 'Invalid params');
    return;
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart?.data) {
    error(-32602, 'No data part found');
    return;
  }

  const skillId = dataPart.data.skillId;
  const skillParams = dataPart.data.params ?? {};

  const result = await executeSkill(skillId, skillParams).catch((err: Error) => {
    error(-32603, err.message);
    return null;
  });

  if (!result) return;

  res.json({
    jsonrpc: '2.0',
    id,
    result: {
      role: 'agent',
      parts: [
        { kind: 'text', text: result.message },
        { kind: 'data', data: result.data },
      ],
      messageId: message.messageId,
      kind: 'message',
    },
  });
});

/**
 * Validates that a file path is safe and within the documentation root.
 * Prevents path traversal attacks by:
 * 1. Resolving the full path
 * 2. Verifying it starts with DOCS_ROOT
 * 3. Only allowing .md files
 * 4. Resolving symlinks to prevent escaping via symlink chains
 * 5. Checking file size to prevent memory exhaustion
 */
async function validateDocPath(pagePath: string): Promise<string> {
  const normalizedPath = path.normalize(pagePath);
  
  if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
    throw new Error('Invalid path: path traversal not allowed');
  }
  
  if (!normalizedPath.endsWith('.md')) {
    throw new Error('Invalid path: only .md files are allowed');
  }
  
  const fullPath = path.resolve(DOCS_ROOT, normalizedPath);
  
  // Check the unresolved path first
  if (!fullPath.startsWith(path.resolve(DOCS_ROOT))) {
    throw new Error('Invalid path: access denied');
  }
  
  // Resolve symlinks and check real path is still within DOCS_ROOT
  const realPath = await realpath(fullPath);
  const realDocsRoot = await realpath(DOCS_ROOT);
  
  if (!realPath.startsWith(realDocsRoot)) {
    throw new Error('Invalid path: symlink escape not allowed');
  }
  
  // Check file size to prevent memory exhaustion
  const fileStat = await stat(realPath);
  if (fileStat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File too large: maximum size is ${MAX_FILE_SIZE_BYTES} bytes`);
  }
  
  return realPath;
}

async function executeSkill(skillId: string, params: Record<string, string>): Promise<SkillResult> {
  switch (skillId) {
    case 'search-docs': {
      const query = (params.query || '').toLowerCase();
      if (query.length > 200) {
        throw new Error('Query too long: maximum 200 characters');
      }
      const results = await searchDocumentation(query);
      return { message: `Found ${results.length} results for "${query}"`, data: { results, query } };
    }
    case 'get-page': {
      const pagePath = params.page || '';
      if (!pagePath) {
        throw new Error('Page parameter is required');
      }
      const safePath = await validateDocPath(pagePath);
      const content = await readFile(safePath, 'utf-8');
      return { message: `Retrieved ${pagePath}`, data: { page: pagePath, content } };
    }
    case 'list-topics': {
      const topics = await listTopics();
      return { message: `${topics.length} documentation topics`, data: { topics } };
    }
    default:
      throw new Error(`Unknown skill: ${skillId}`);
  }
}

app.listen(PORT, () => {
  console.log(`Documentation A2A server running on http://localhost:${PORT}`);
  console.log(`  Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`  A2A Endpoint: http://localhost:${PORT}/api/a2a`);
});
