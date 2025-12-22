/**
 * MCP Resources Read Endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { MCPResourceReadRequestSchema } from '@/schemas/api';
import { expectValid, expectExists } from '@/lib/validation';
import { getCORSHeaders } from '@/lib/mcp/constants';
import { readMCPResource } from '@/lib/mcp/resources';

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, { headers: getCORSHeaders(origin) });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const body = await request.json();
  const { uri } = expectValid(MCPResourceReadRequestSchema, body, 'MCP resource read request');

  const contents = await readMCPResource(uri);
  expectExists(contents, 'Resource not found');

  return NextResponse.json({
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(contents, null, 2),
    }],
  }, { headers: getCORSHeaders(origin) });
}
