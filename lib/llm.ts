

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

export type LLMResponse =
  | { type: 'sql'; query: string; explanation: string }
  | { type: 'direct'; answer: string }
  | { type: 'off_topic'; message: string }
  | { type: 'error'; message: string };

async function callGroq(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in .env.local');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

export async function classifyAndGenerateSQL(
  userMessage: string,
  schemaDescription: string,
  conversationHistory: { role: string; content: string }[] = []
): Promise<LLMResponse> {
  try {
    const historyText = conversationHistory.slice(-6)
      .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
      .join('\n');

    const systemPrompt = `You are an expert data analyst for an Order-to-Cash (OTC) business intelligence system.

Your ONLY job is to answer questions about this specific dataset:
${schemaDescription}

STRICT RULES:
1. ONLY answer questions about: orders, deliveries, billing documents, journal entries, customers, products and their relationships.
2. For ANY off-topic question (general knowledge, coding help, creative writing, math, personal advice, etc.) respond with the off_topic JSON type.
3. Generate ONLY valid SQLite SQL. No PostgreSQL or MySQL syntax.
4. Use proper JOINs and table aliases.
5. LIMIT results to 50 rows unless the user asks for aggregates.
6. NEVER use DROP, DELETE, INSERT, UPDATE or any DDL — SELECT only.

RESPONSE FORMAT: respond ONLY with a single valid JSON object. No markdown. No explanation outside the JSON.

For dataset questions:
{"type":"sql","query":"SELECT ...","explanation":"what this query does"}

For simple factual answers that need no SQL:
{"type":"direct","answer":"your answer"}

For off-topic questions:
{"type":"off_topic","message":"This system is designed to answer questions related to the Order-to-Cash dataset only. I can help you explore orders, deliveries, billing documents, customers, products, and their relationships."}`;

    const userPrompt = `${historyText ? `Recent conversation:\n${historyText}\n\n` : ''}User question: ${userMessage}

Respond with a single JSON object only. No markdown fences, no explanation outside the JSON.`;

    const raw = await callGroq(systemPrompt, userPrompt);


    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();


    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);
    if (['sql', 'direct', 'off_topic'].includes(parsed.type)) {
      return parsed as LLMResponse;
    }

    return { type: 'error', message: 'Unexpected response format from LLM' };
  } catch (err: unknown) {
    console.error('LLM error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return { type: 'error', message: `LLM error: ${msg}` };
  }
}

export async function formatQueryResult(
  userQuestion: string,
  sqlQuery: string,
  results: Record<string, unknown>[],
  explanation: string
): Promise<string> {
  try {
    if (results.length === 0) {
      return "No records found matching your query. The data may not exist in the dataset, or the identifiers may differ from what's stored.";
    }

    const systemPrompt = `You are a business analyst presenting data insights from an Order-to-Cash system.
Answer questions directly and concisely using only the provided data.
- Lead with the key insight
- Use actual numbers and values from the data
- Keep it to 2-4 sentences max
- Never mention SQL, tables, queries, or technical details
- Use business language`;

    const userPrompt = `User question: "${userQuestion}"
Query description: ${explanation}
Results (${results.length} total rows, showing up to 20):
${JSON.stringify(results.slice(0, 20), null, 2)}

${results.length > 20 ? `Note: showing top 20 of ${results.length} results.` : ''}

Answer the question using this data:`;

    const answer = await callGroq(systemPrompt, userPrompt);
    return answer.trim();
  } catch {

    if (results.length === 0) return 'No results found.';
    const keys = Object.keys(results[0]);
    const lines = results.slice(0, 10).map(r => keys.map(k => `${k}: ${r[k]}`).join(' | '));
    return `Found ${results.length} results:\n${lines.join('\n')}${results.length > 10 ? `\n...and ${results.length - 10} more` : ''}`;
  }
}
