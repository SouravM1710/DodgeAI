# AI Coding Session Log
## Tool: Claude (claude.ai)
## Task: Order-to-Cash Graph Intelligence System

---

### Session Overview

**Date:** 2025  
**Duration:** ~4 hours  
**Model:** Claude Sonnet

---

### Prompt 1 — Architecture Planning

**User:**
> I've been assigned a task to build a graph-based data modeling and query system with LLM-powered chat. The dataset includes orders, deliveries, invoices, payments, customers, products. Stack: React/Next.js, Gemini (free tier), Vercel. What architecture do you recommend?

**Claude:**
Recommended SQLite + Next.js + Gemini 1.5 Flash architecture. Key decision: use SQLite over Neo4j because the data is relational, Gemini generates verifiable SQL, and it's zero-infra. Two-stage LLM prompting for guardrails + grounded answers. react-force-graph-2d for visualization.

**Iteration:** Accepted. Asked to proceed with full implementation.

---

### Prompt 2 — Database Schema

**User:**
> Write the SQLite schema and seed script. The CSVs may have varied column names.

**Claude:**
Created `lib/db.ts` with full schema for 7 tables: customers, products, sales_orders, sales_order_items, deliveries, billing_documents, journal_entries. Added indexes on all FK columns.

Created `scripts/seed.ts` with fuzzy column matching — a `col()` helper that normalizes column names (strips spaces/underscores, case-insensitive) so the script works regardless of exact CSV header names.

**Debugging:**
- Initial version didn't handle BOM characters in CSVs → added `bom: true` to csv-parse options
- Journal entries had no natural PK → added auto-incrementing `je_N` fallback ID

---

### Prompt 3 — LLM Integration & Guardrails

**User:**
> Build the Gemini integration. Must handle off-topic rejection, generate only SELECT SQL, and format results as natural language. Two-stage approach.

**Claude:**
Designed the two-stage pipeline in `lib/llm.ts`:

Stage 1 system prompt forces JSON-only output with `type: "sql" | "off_topic" | "direct"`. The off-topic detection is handled by the LLM itself (not keyword matching) for better accuracy.

Stage 2 formats raw SQL results into business language — instructs the model to never mention SQL or table names.

**Key prompting decisions:**
- Providing the full schema description in every Stage 1 call (not just table names) significantly improved SQL accuracy
- Including last 6 messages of conversation history handled follow-up questions correctly
- Explicitly listing forbidden SQL keywords (DROP, DELETE, INSERT) in the system prompt reduced the rare cases where the model tried to suggest data modifications

**Debugging:**
- Gemini occasionally wraps JSON in markdown fences → added cleanup: `text.replace(/^```json\s*/i, '')`
- Some queries generated `ILIKE` (PostgreSQL) → added explicit "SQLite only, no ILIKE" instruction

---

### Prompt 4 — Graph Construction

**User:**
> Build the graph module. Need overview mode (200 nodes sampled) and ego-graph mode (expand a specific node).

**Claude:**
Created `lib/graph.ts` with two modes:
- `buildOverviewGraph`: samples proportionally across entity types
- `buildEgoGraph`: starts from one node, follows all FK relationships outward

Node deduplication via Set to prevent duplicate edges. Color-coded by entity type.

**Iteration:**
- First version didn't handle the case where a billing doc links to SO directly (no delivery) → added fallback edge logic
- Added `val` property per node type to control size (customers/orders larger, journal entries smaller)

---

### Prompt 5 — Graph Visualization Component

**User:**
> Build the react-force-graph-2d component with node highlighting when chat returns results, click-to-inspect, and ego-graph expand on click.

**Claude:**
Created `components/GraphVisualization.tsx` with custom `nodeCanvasObject` for pixel-perfect rendering. Highlights detected via `highlightIds` prop — matching nodes get glow effect and white fill.

**Key decisions:**
- Dynamic import with `ssr: false` required for force-graph (uses `window`)
- `ResizeObserver` for responsive canvas sizing
- Labels only shown at zoom > 1.5x to avoid clutter at overview scale

---

### Prompt 6 — Chat UI

**User:**
> Build the chat interface. Should show SQL on toggle, results table preview, typing indicator, example queries for first-time users.

**Claude:**
Created `components/ChatInterface.tsx` with message history, typing animation, SQL disclosure toggle, results table preview (first 5 rows), and 3 example queries shown before first message.

---

### Prompt 7 — Main Page Layout

**User:**
> Wire everything together. Graph on left (takes remaining space), chat sidebar on right (400px). Header with search, breadcrumb for focused node, hide/show chat toggle.

**Claude:**
Created `app/page.tsx` with the full layout. Graph highlighting and ego-graph expansion connected via callbacks. Search calls `/api/graph-data` for entity lookup.

---

### Key Architectural Choices Defended

**Q: Why not use a vector database for semantic search?**  
A: The dataset has exact IDs and structured fields. SQL is more precise and verifiable than vector similarity for this domain. Added as a bonus extension note.

**Q: Why SQLite and not Postgres?**  
A: Zero infra. Vercel serverless functions can't maintain a persistent Postgres connection without a connection pooler (Neon/Supabase). SQLite runs in the same process. For a dataset of this size (< 100K rows) it's faster too.

**Q: How do you prevent SQL injection?**  
A: Two layers: (1) the LLM system prompt tells Gemini to never generate DDL/DML, (2) the server explicitly checks that the query starts with `SELECT` before execution. The schema context in the prompt also means the LLM only knows valid table/column names.

---

### Patterns That Worked Well

1. **Schema-first prompting**: giving Gemini the complete schema description (not just table names) in every call dramatically improved JOIN accuracy
2. **JSON-only output mode**: enforcing structured JSON from Stage 1 made the pipeline reliable and easy to parse
3. **Fuzzy column matching in seed script**: using a normalized comparison function instead of exact string matching made the ingestion robust to CSV variations
4. **Two-stage LLM pipeline**: separating "generate SQL" from "format result" kept each stage focused and easier to debug

### What I'd Do Differently With More Time

1. Add streaming responses from Gemini for better perceived performance
2. Implement graph clustering (group nodes by entity type) for large datasets
3. Add conversation memory / session persistence
4. Semantic search over entity names using embeddings
5. Export query results to CSV
