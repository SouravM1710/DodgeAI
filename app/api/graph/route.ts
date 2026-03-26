import { NextRequest, NextResponse } from 'next/server';
import { buildGraph } from '@/lib/graph';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const focusId = searchParams.get('focus');
    const maxNodes = parseInt(searchParams.get('max') || '200', 10);

    const graph = buildGraph({ maxNodes, focusId });
    return NextResponse.json(graph);
  } catch (err) {
    console.error('Graph API error:', err);
    return NextResponse.json({ error: 'Failed to build graph', nodes: [], links: [], stats: {} }, { status: 500 });
  }
}
