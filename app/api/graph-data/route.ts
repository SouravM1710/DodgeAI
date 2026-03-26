import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q')?.toLowerCase();
    const type = searchParams.get('type');

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const db = getDb();
    const results: Array<{ id: string; label: string; type: string; subtitle: string }> = [];

    if (!type || type === 'customer') {
      const rows = db.prepare(
        `SELECT customer_id, customer_name, city FROM customers WHERE lower(customer_name) LIKE ? OR customer_id LIKE ? LIMIT 5`
      ).all(`%${query}%`, `%${query}%`) as Array<Record<string, unknown>>;
      for (const r of rows) {
        results.push({ id: `cust_${r.customer_id}`, label: String(r.customer_name || r.customer_id), type: 'customer', subtitle: String(r.city || '') });
      }
    }

    if (!type || type === 'sales_order') {
      const rows = db.prepare(
        `SELECT so.sales_order_id, c.customer_name, so.order_date FROM sales_orders so LEFT JOIN customers c ON so.customer_id = c.customer_id WHERE so.sales_order_id LIKE ? LIMIT 5`
      ).all(`%${query}%`) as Array<Record<string, unknown>>;
      for (const r of rows) {
        results.push({ id: `so_${r.sales_order_id}`, label: `SO ${r.sales_order_id}`, type: 'sales_order', subtitle: String(r.customer_name || '') });
      }
    }

    if (!type || type === 'billing') {
      const rows = db.prepare(
        `SELECT billing_id, billing_date, total_amount, currency FROM billing_documents WHERE billing_id LIKE ? LIMIT 5`
      ).all(`%${query}%`) as Array<Record<string, unknown>>;
      for (const r of rows) {
        results.push({ id: `bill_${r.billing_id}`, label: `BILL ${r.billing_id}`, type: 'billing', subtitle: `${r.currency} ${r.total_amount}` });
      }
    }

    if (!type || type === 'delivery') {
      const rows = db.prepare(
        `SELECT delivery_id, plant, status FROM deliveries WHERE delivery_id LIKE ? LIMIT 5`
      ).all(`%${query}%`) as Array<Record<string, unknown>>;
      for (const r of rows) {
        results.push({ id: `del_${r.delivery_id}`, label: `DEL ${r.delivery_id}`, type: 'delivery', subtitle: String(r.plant || r.status || '') });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Search API error:', err);
    return NextResponse.json({ results: [] });
  }
}
