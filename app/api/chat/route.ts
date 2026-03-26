import { NextRequest, NextResponse } from 'next/server';
import { getDb, SCHEMA_DESCRIPTION } from '@/lib/db';
import { classifyAndGenerateSQL, formatQueryResult } from '@/lib/llm';

export const dynamic = 'force-dynamic';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  answer: string;
  sql?: string;
  results?: Record<string, unknown>[];
  rowCount?: number;
  type: 'sql' | 'direct' | 'off_topic' | 'error';
  highlightIds?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history = [] }: { message: string; history: ChatMessage[] } = body;

    if (!message?.trim()) {
      return NextResponse.json({ answer: 'Please enter a question.', type: 'error' });
    }


    const llmResponse = await classifyAndGenerateSQL(message, SCHEMA_DESCRIPTION, history);

    if (llmResponse.type === 'off_topic') {
      return NextResponse.json({
        answer: llmResponse.message,
        type: 'off_topic',
      } as ChatResponse);
    }

    if (llmResponse.type === 'direct') {
      return NextResponse.json({
        answer: llmResponse.answer,
        type: 'direct',
      } as ChatResponse);
    }

    if (llmResponse.type === 'error') {
      return NextResponse.json({
        answer: llmResponse.message,
        type: 'error',
      } as ChatResponse);
    }


    const db = getDb();
    let results: Record<string, unknown>[] = [];
    let sqlError: string | null = null;

    try {

      const cleanSQL = llmResponse.query
        .trim()
        .replace(/;+\s*$/, '');

      if (!/^\s*(SELECT|WITH)\s/i.test(cleanSQL)) {
        throw new Error('Only SELECT (and WITH/CTE) queries are permitted.');
      }

      if (cleanSQL.includes(';')) {
        throw new Error('Only a single SQL statement is permitted.');
      }

      results = db.prepare(cleanSQL).all() as Record<string, unknown>[];
    } catch (err) {
      sqlError = err instanceof Error ? err.message : 'SQL execution failed';
      console.error('SQL error:', sqlError, '\nQuery:', llmResponse.query);
    }

    if (sqlError) {
      return NextResponse.json({
        answer: `I encountered an issue executing that query: ${sqlError}. Please try rephrasing your question.`,
        sql: llmResponse.query,
        type: 'error',
      } as ChatResponse);
    }

    const answer = await formatQueryResult(message, llmResponse.query, results, llmResponse.explanation);

    const highlightIds = extractHighlightIds(results);

    return NextResponse.json({
      answer,
      sql: llmResponse.query,
      results: results.slice(0, 50),
      rowCount: results.length,
      type: 'sql',
      highlightIds,
    } as ChatResponse);

  } catch (err) {
    console.error('Chat API error:', err);
    return NextResponse.json({
      answer: 'An unexpected error occurred. Please try again.',
      type: 'error',
    } as ChatResponse);
  }
}


function extractHighlightIds(results: Record<string, unknown>[]): string[] {
  const ids: string[] = [];
  const idFields = {
    billing_id: 'bill_',
    sales_order_id: 'so_',
    delivery_id: 'del_',
    customer_id: 'cust_',
    journal_id: 'je_',
  };

  for (const row of results.slice(0, 20)) {
    for (const [field, prefix] of Object.entries(idFields)) {
      if (row[field]) ids.push(`${prefix}${row[field]}`);
    }
  }

  return Array.from(new Set(ids)).slice(0, 30);
}
