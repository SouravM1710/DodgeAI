import type { ChatResponse } from '@/app/api/chat/route';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Message extends ChatMessage {
  type?: ChatResponse['type'];
  sql?: string;
  rowCount?: number;
  results?: Record<string, unknown>[];
  timestamp: Date;
}