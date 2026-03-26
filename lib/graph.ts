import { getDb } from './db';
export type { GraphNode, GraphEdge, GraphData } from './graph-types';
export { NODE_COLORS, NODE_LABELS } from './graph-types';
import type { GraphNode, GraphData, GraphEdge } from './graph-types';
import { NODE_COLORS } from './graph-types';


export function buildGraph(
  options: {
    maxNodes?: number;
    filterType?: GraphNode['type'] | null;
    focusId?: string | null;
    depth?: number;
  } = {}
): GraphData {
  const db = getDb();
  const { maxNodes = 200, focusId = null } = options;

  const nodes: GraphNode[] = [];
  const links: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  function addNode(node: GraphNode) {
    if (nodeIds.has(node.id)) return;
    if (nodes.length >= maxNodes) return;
    nodeIds.add(node.id);
    nodes.push({ ...node, color: NODE_COLORS[node.type] });
  }

  function addLink(source: string, target: string, label: string) {
    if (nodeIds.has(source) && nodeIds.has(target)) {
      links.push({ source, target, label, color: 'rgba(148,163,184,0.3)' });
    }
  }

  if (focusId) {
    buildEgoGraph(db, focusId, addNode, addLink, nodeIds, maxNodes);
  } else {
    buildOverviewGraph(db, maxNodes, addNode, addLink, nodeIds);
  }


  const stats = {
    customers: (db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number }).c,
    sales_orders: (db.prepare('SELECT COUNT(*) as c FROM sales_orders').get() as { c: number }).c,
    deliveries: (db.prepare('SELECT COUNT(*) as c FROM deliveries').get() as { c: number }).c,
    billing_documents: (db.prepare('SELECT COUNT(*) as c FROM billing_documents').get() as { c: number }).c,
    journal_entries: (db.prepare('SELECT COUNT(*) as c FROM journal_entries').get() as { c: number }).c,
    products: (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c,
  };

  return { nodes, links, stats };
}

function placeholders(n: number) {
  return new Array(n).fill('?').join(', ');
}

function buildOverviewGraph(
  db: ReturnType<typeof getDb>,
  maxNodes: number,
  addNode: (n: GraphNode) => void,
  addLink: (s: string, t: string, l: string) => void,
  nodeIds: Set<string>
) {

  const customersLimit = Math.max(1, Math.floor(maxNodes * 0.15));
  const ordersLimit = Math.max(5, Math.floor(maxNodes * 0.25));
  const deliveriesLimit = Math.max(5, Math.floor(maxNodes * 0.18));
  const billingsLimit = Math.max(5, Math.floor(maxNodes * 0.18));
  const journalsLimit = Math.max(5, Math.floor(maxNodes * 0.10));
  const productsLimit = Math.max(10, Math.floor(maxNodes * 0.25));


  const customers = db.prepare(
    `SELECT customer_id, customer_name, city, country, industry
     FROM customers
     LIMIT ?`
  ).all(customersLimit) as Array<Record<string, unknown>>;

  const customerIds = customers.map(c => String(c.customer_id));
  for (const c of customers) {
    addNode({
      id: `cust_${c.customer_id}`,
      label: String(c.customer_name || c.customer_id),
      type: 'customer',
      data: c,
      val: 4,
    });
  }

  if (customerIds.length === 0) return;


  const orders = db.prepare(
    `SELECT so.*, c.customer_name
     FROM sales_orders so
     LEFT JOIN customers c ON so.customer_id = c.customer_id
     WHERE so.customer_id IN (${placeholders(customerIds.length)})
     LIMIT ?`
  ).all([...customerIds, ordersLimit]) as Array<Record<string, unknown>>;

  const salesOrderIds = orders.map(o => String(o.sales_order_id));
  for (const o of orders) {
    addNode({
      id: `so_${o.sales_order_id}`,
      label: `SO ${o.sales_order_id}`,
      type: 'sales_order',
      data: o,
      val: 3,
    });
    addLink(`cust_${o.customer_id}`, `so_${o.sales_order_id}`, 'placed');
  }

  if (salesOrderIds.length === 0) return;


  const deliveries = db.prepare(
    `SELECT *
     FROM deliveries
     WHERE sales_order_id IN (${placeholders(salesOrderIds.length)})
     LIMIT ?`
  ).all([...salesOrderIds, deliveriesLimit]) as Array<Record<string, unknown>>;

  const deliveryIds = deliveries.map(d => String(d.delivery_id));
  for (const d of deliveries) {
    addNode({
      id: `del_${d.delivery_id}`,
      label: `DEL ${d.delivery_id}`,
      type: 'delivery',
      data: d,
      val: 3,
    });
    addLink(`so_${d.sales_order_id}`, `del_${d.delivery_id}`, 'fulfilled_by');
  }


  const billingsByDelivery = deliveryIds.length > 0
    ? (db.prepare(
        `SELECT *
         FROM billing_documents
         WHERE delivery_id IN (${placeholders(deliveryIds.length)})
         LIMIT ?`
      ).all([...deliveryIds, billingsLimit]) as Array<Record<string, unknown>>)
    : [];

  const billingsBySo = db.prepare(
    `SELECT *
     FROM billing_documents
     WHERE delivery_id IS NULL AND sales_order_id IN (${placeholders(salesOrderIds.length)})
     LIMIT ?`
  ).all([...salesOrderIds, billingsLimit]) as Array<Record<string, unknown>>;

  const billingsMap = new Map<string, Record<string, unknown>>();
  for (const b of [...billingsByDelivery, ...billingsBySo]) {
    const id = String(b.billing_id);
    if (!billingsMap.has(id)) billingsMap.set(id, b);
    if (billingsMap.size >= billingsLimit) break;
  }
  const billings = Array.from(billingsMap.values());
  const billingIds = billings.map(b => String(b.billing_id));

  for (const b of billings) {
    addNode({
      id: `bill_${b.billing_id}`,
      label: `BILL ${b.billing_id}`,
      type: 'billing',
      data: b,
      val: 3,
    });
    if (b.delivery_id) addLink(`del_${b.delivery_id}`, `bill_${b.billing_id}`, 'billed_as');
    else addLink(`so_${b.sales_order_id}`, `bill_${b.billing_id}`, 'billed_as');
  }

  if (billingIds.length > 0) {

    const journals = db.prepare(
      `SELECT *
       FROM journal_entries
       WHERE billing_id IN (${placeholders(billingIds.length)})
       LIMIT ?`
    ).all([...billingIds, journalsLimit]) as Array<Record<string, unknown>>;

    for (const j of journals) {
      addNode({
        id: `je_${j.journal_id}`,
        label: `JE ${j.accounting_document || j.journal_id}`,
        type: 'journal',
        data: j,
        val: 2,
      });
      if (j.billing_id) addLink(`bill_${j.billing_id}`, `je_${j.journal_id}`, 'recorded_in');
    }
  }


  const soItemRows = db.prepare(
    `SELECT sales_order_id, product_id
     FROM sales_order_items
     WHERE sales_order_id IN (${placeholders(salesOrderIds.length)})
     LIMIT ?`
  ).all([...salesOrderIds, productsLimit * 3]) as Array<Record<string, unknown>>;

  const delItemRows = deliveryIds.length > 0
    ? (db.prepare(
        `SELECT delivery_id, product_id
         FROM delivery_items
         WHERE delivery_id IN (${placeholders(deliveryIds.length)})
         LIMIT ?`
      ).all([...deliveryIds, productsLimit * 3]) as Array<Record<string, unknown>>)
    : [];

  const billItemRows = billingIds.length > 0
    ? (db.prepare(
        `SELECT billing_id, product_id
         FROM billing_items
         WHERE billing_id IN (${placeholders(billingIds.length)})
         LIMIT ?`
      ).all([...billingIds, productsLimit * 3]) as Array<Record<string, unknown>>)
    : [];

  const productIds = Array.from(new Set([
    ...soItemRows.map(r => r.product_id ? String(r.product_id) : null).filter(Boolean),
    ...delItemRows.map(r => r.product_id ? String(r.product_id) : null).filter(Boolean),
    ...billItemRows.map(r => r.product_id ? String(r.product_id) : null).filter(Boolean),
  ])).slice(0, productsLimit);

  if (productIds.length > 0) {
    const productRows = db.prepare(
      `SELECT * FROM products WHERE product_id IN (${placeholders(productIds.length)})`
    ).all(productIds) as Array<Record<string, unknown>>;

    const productById = new Map<string, Record<string, unknown>>();
    for (const p of productRows) productById.set(String(p.product_id), p);

    for (const pid of productIds) {
      const p = productById.get(pid);
      addNode({
        id: `prod_${pid}`,
        label: p ? String(p.product_name || pid) : pid,
        type: 'product',
        data: p || { product_id: pid },
        val: 2,
      });
    }


    for (const r of soItemRows) {
      if (!r.product_id) continue;
      addLink(`so_${r.sales_order_id}`, `prod_${r.product_id}`, 'ordered_product');
    }
    for (const r of delItemRows) {
      if (!r.product_id) continue;
      addLink(`del_${r.delivery_id}`, `prod_${r.product_id}`, 'delivered_product');
    }
    for (const r of billItemRows) {
      if (!r.product_id) continue;
      addLink(`bill_${r.billing_id}`, `prod_${r.product_id}`, 'billed_product');
    }
  }
}

function buildEgoGraph(
  db: ReturnType<typeof getDb>,
  focusId: string,
  addNode: (n: GraphNode) => void,
  addLink: (s: string, t: string, l: string) => void,
  nodeIds: Set<string>,
  maxNodes: number
) {

  const [prefix, ...rest] = focusId.split('_');
  const rawId = rest.join('_');

  if (prefix === 'cust') {
    const c = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(rawId) as Record<string, unknown> | undefined;
    if (c) {
      addNode({ id: focusId, label: String(c.customer_name || rawId), type: 'customer', data: c, val: 6 });
      const orders = db.prepare('SELECT * FROM sales_orders WHERE customer_id = ? LIMIT 20').all(rawId) as Array<Record<string, unknown>>;
      for (const o of orders) expandOrder(db, o, addNode, addLink, nodeIds);
    }
  } else if (prefix === 'so') {
    const o = db.prepare('SELECT * FROM sales_orders WHERE sales_order_id = ?').get(rawId) as Record<string, unknown> | undefined;
    if (o) expandOrder(db, o, addNode, addLink, nodeIds);
  } else if (prefix === 'del') {
    const d = db.prepare('SELECT * FROM deliveries WHERE delivery_id = ?').get(rawId) as Record<string, unknown> | undefined;
    if (d) expandDelivery(db, d, addNode, addLink, nodeIds, maxNodes);
  } else if (prefix === 'bill') {
    const b = db.prepare('SELECT * FROM billing_documents WHERE billing_id = ?').get(rawId) as Record<string, unknown> | undefined;
    if (b) expandBilling(db, b, addNode, addLink, nodeIds);
  } else if (prefix === 'je') {
    const j = db.prepare('SELECT * FROM journal_entries WHERE journal_id = ?').get(rawId) as Record<string, unknown> | undefined;
    if (j) expandJournal(db, j, addNode, addLink, nodeIds, maxNodes);
  } else if (prefix === 'prod') {
    const p = db.prepare('SELECT * FROM products WHERE product_id = ?').get(rawId) as Record<string, unknown> | undefined;
    if (p) expandProduct(db, p, addNode, addLink, nodeIds, maxNodes);
  }
}

function expandDelivery(
  db: ReturnType<typeof getDb>,
  d: Record<string, unknown>,
  addNode: (n: GraphNode) => void,
  addLink: (s: string, t: string, l: string) => void,
  nodeIds: Set<string>,
  maxNodes: number
) {
  const deliveryId = d.delivery_id as string;
  addNode({ id: `del_${deliveryId}`, label: `DEL ${deliveryId}`, type: 'delivery', data: d, val: 6 });


  if (d.sales_order_id) {
    const o = db.prepare('SELECT * FROM sales_orders WHERE sales_order_id = ?').get(d.sales_order_id) as Record<string, unknown> | undefined;
    if (o) {
      addNode({ id: `so_${o.sales_order_id}`, label: `SO ${o.sales_order_id}`, type: 'sales_order', data: o, val: 4 });
      addLink(`so_${o.sales_order_id}`, `del_${deliveryId}`, 'fulfilled_by');

      if (o.customer_id) {
        const c = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(o.customer_id) as Record<string, unknown> | undefined;
        if (c) {
          addNode({ id: `cust_${c.customer_id}`, label: String(c.customer_name || c.customer_id), type: 'customer', data: c, val: 4 });
          addLink(`cust_${c.customer_id}`, `so_${o.sales_order_id}`, 'placed');
        }
      }
    }
  } else if (d.customer_id) {
    const c = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(d.customer_id) as Record<string, unknown> | undefined;
    if (c) addNode({ id: `cust_${c.customer_id}`, label: String(c.customer_name || c.customer_id), type: 'customer', data: c, val: 4 });
  }


  const bills = db.prepare('SELECT * FROM billing_documents WHERE delivery_id = ? LIMIT 50').all(deliveryId) as Array<Record<string, unknown>>;
  for (const b of bills) expandBilling(db, b, addNode, addLink, nodeIds);


  const items = db.prepare(
    `SELECT product_id
     FROM delivery_items
     WHERE delivery_id = ?
     LIMIT ?`
  ).all(deliveryId, Math.min(400, maxNodes * 2)) as Array<Record<string, unknown>>;

  const productIds = Array.from(new Set(items.map(it => (it.product_id ? String(it.product_id) : null)).filter(Boolean))).slice(0, Math.max(10, Math.floor(maxNodes * 0.25)));
  if (productIds.length > 0) {
    const productRows = db.prepare(
      `SELECT * FROM products WHERE product_id IN (${placeholders(productIds.length)})`
    ).all(productIds) as Array<Record<string, unknown>>;

    const productById = new Map<string, Record<string, unknown>>();
    for (const p of productRows) productById.set(String(p.product_id), p);

    for (const pid of productIds) {
      const p = productById.get(pid);
      addNode({ id: `prod_${pid}`, label: p ? String(p.product_name || pid) : pid, type: 'product', data: p || { product_id: pid }, val: 3 });
      addLink(`del_${deliveryId}`, `prod_${pid}`, 'delivered_product');
    }
  }
}

function expandJournal(
  db: ReturnType<typeof getDb>,
  j: Record<string, unknown>,
  addNode: (n: GraphNode) => void,
  addLink: (s: string, t: string, l: string) => void,
  nodeIds: Set<string>,
  maxNodes: number
) {
  const journalId = j.journal_id as string;
  addNode({ id: `je_${journalId}`, label: `JE ${j.accounting_document || journalId}`, type: 'journal', data: j, val: 6 });

  const billingId = j.billing_id ? String(j.billing_id) : (j.reference_document ? String(j.reference_document) : null);
  if (!billingId) return;

  const b = db.prepare('SELECT * FROM billing_documents WHERE billing_id = ?').get(billingId) as Record<string, unknown> | undefined;
  if (b) expandBilling(db, b, addNode, addLink, nodeIds);
}

function expandProduct(
  db: ReturnType<typeof getDb>,
  p: Record<string, unknown>,
  addNode: (n: GraphNode) => void,
  addLink: (s: string, t: string, l: string) => void,
  nodeIds: Set<string>,
  maxNodes: number
) {
  const productId = p.product_id as string;
  addNode({ id: `prod_${productId}`, label: String(p.product_name || productId), type: 'product', data: p, val: 6 });


  const soRows = db.prepare(
    `SELECT DISTINCT sales_order_id
     FROM sales_order_items
     WHERE product_id = ?
     LIMIT ?`
  ).all(productId, Math.min(50, Math.max(10, Math.floor(maxNodes / 4)))) as Array<Record<string, unknown>>;

  for (const r of soRows) {
    const soId = String(r.sales_order_id);
    const o = db.prepare('SELECT * FROM sales_orders WHERE sales_order_id = ?').get(soId) as Record<string, unknown> | undefined;
    if (!o) continue;
    addNode({ id: `so_${o.sales_order_id}`, label: `SO ${o.sales_order_id}`, type: 'sales_order', data: o, val: 3 });
    addLink(`so_${o.sales_order_id}`, `prod_${productId}`, 'ordered_product');

    if (o.customer_id) {
      const c = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(o.customer_id) as Record<string, unknown> | undefined;
      if (c) {
        addNode({ id: `cust_${c.customer_id}`, label: String(c.customer_name || c.customer_id), type: 'customer', data: c, val: 2 });
        addLink(`cust_${c.customer_id}`, `so_${o.sales_order_id}`, 'placed');
      }
    }
  }


  const delRows = db.prepare(
    `SELECT DISTINCT delivery_id
     FROM delivery_items
     WHERE product_id = ?
     LIMIT ?`
  ).all(productId, Math.min(50, Math.max(10, Math.floor(maxNodes / 4)))) as Array<Record<string, unknown>>;

  for (const r of delRows) {
    const delId = String(r.delivery_id);
    const d = db.prepare('SELECT * FROM deliveries WHERE delivery_id = ?').get(delId) as Record<string, unknown> | undefined;
    if (!d) continue;
    addNode({ id: `del_${d.delivery_id}`, label: `DEL ${d.delivery_id}`, type: 'delivery', data: d, val: 3 });
    addLink(`del_${d.delivery_id}`, `prod_${productId}`, 'delivered_product');
  }


  const billRows = db.prepare(
    `SELECT DISTINCT billing_id
     FROM billing_items
     WHERE product_id = ?
     LIMIT ?`
  ).all(productId, Math.min(50, Math.max(10, Math.floor(maxNodes / 4)))) as Array<Record<string, unknown>>;

  for (const r of billRows) {
    const billId = String(r.billing_id);
    const b = db.prepare('SELECT * FROM billing_documents WHERE billing_id = ?').get(billId) as Record<string, unknown> | undefined;
    if (!b) continue;
    addNode({ id: `bill_${b.billing_id}`, label: `BILL ${b.billing_id}`, type: 'billing', data: b, val: 3 });
    addLink(`bill_${b.billing_id}`, `prod_${productId}`, 'billed_product');
  }
}

function expandOrder(
  db: ReturnType<typeof getDb>,
  o: Record<string, unknown>,
  addNode: (n: GraphNode) => void,
  addLink: (s: string, t: string, l: string) => void,
  nodeIds: Set<string>
) {
  addNode({ id: `so_${o.sales_order_id}`, label: `SO ${o.sales_order_id}`, type: 'sales_order', data: o, val: 5 });


  if (o.customer_id) {
    const c = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(o.customer_id as string) as Record<string, unknown> | undefined;
    if (c) {
      addNode({ id: `cust_${c.customer_id}`, label: String(c.customer_name || c.customer_id), type: 'customer', data: c, val: 4 });
      addLink(`cust_${c.customer_id}`, `so_${o.sales_order_id}`, 'placed');
    }
  }


  const deliveries = db.prepare('SELECT * FROM deliveries WHERE sales_order_id = ?').all(o.sales_order_id as string) as Array<Record<string, unknown>>;
  for (const d of deliveries) {
    addNode({ id: `del_${d.delivery_id}`, label: `DEL ${d.delivery_id}`, type: 'delivery', data: d, val: 4 });
    addLink(`so_${o.sales_order_id}`, `del_${d.delivery_id}`, 'fulfilled_by');


    const bills = db.prepare('SELECT * FROM billing_documents WHERE delivery_id = ?').all(d.delivery_id as string) as Array<Record<string, unknown>>;
    for (const b of bills) expandBilling(db, b, addNode, addLink, nodeIds);
  }


  const directBills = db.prepare('SELECT * FROM billing_documents WHERE sales_order_id = ? AND delivery_id IS NULL').all(o.sales_order_id as string) as Array<Record<string, unknown>>;
  for (const b of directBills) {
    addNode({ id: `bill_${b.billing_id}`, label: `BILL ${b.billing_id}`, type: 'billing', data: b, val: 3 });
    addLink(`so_${o.sales_order_id}`, `bill_${b.billing_id}`, 'billed_as');
  }


  const items = db.prepare(
    `SELECT product_id
     FROM sales_order_items
     WHERE sales_order_id = ?
     LIMIT 200`
  ).all(o.sales_order_id as string) as Array<Record<string, unknown>>;

  const productIds = Array.from(new Set(items.map(it => (it.product_id ? String(it.product_id) : null)).filter(Boolean)));
  if (productIds.length > 0) {
    const productRows = db.prepare(
      `SELECT * FROM products WHERE product_id IN (${placeholders(productIds.length)})`
    ).all(productIds) as Array<Record<string, unknown>>;

    const productById = new Map<string, Record<string, unknown>>();
    for (const p of productRows) productById.set(String(p.product_id), p);

    for (const pid of productIds) {
      const p = productById.get(pid);
      addNode({ id: `prod_${pid}`, label: p ? String(p.product_name || pid) : pid, type: 'product', data: p || { product_id: pid }, val: 2 });
    }

    for (const it of items) {
      if (!it.product_id) continue;
      addLink(`so_${o.sales_order_id}`, `prod_${it.product_id}`, 'ordered_product');
    }
  }
}

function expandBilling(
  db: ReturnType<typeof getDb>,
  b: Record<string, unknown>,
  addNode: (n: GraphNode) => void,
  addLink: (s: string, t: string, l: string) => void,
  _nodeIds: Set<string>
) {
  addNode({ id: `bill_${b.billing_id}`, label: `BILL ${b.billing_id}`, type: 'billing', data: b, val: 4 });


  if (b.delivery_id) {
    const d = db.prepare('SELECT * FROM deliveries WHERE delivery_id = ?').get(b.delivery_id) as Record<string, unknown> | undefined;
    if (d) {
      addNode({ id: `del_${d.delivery_id}`, label: `DEL ${d.delivery_id}`, type: 'delivery', data: d, val: 3 });
      addLink(`del_${d.delivery_id}`, `bill_${b.billing_id}`, 'billed_as');
    }
  }


  if (b.sales_order_id) {
    const o = db.prepare('SELECT * FROM sales_orders WHERE sales_order_id = ?').get(b.sales_order_id) as Record<string, unknown> | undefined;
    if (o) {
      addNode({ id: `so_${o.sales_order_id}`, label: `SO ${o.sales_order_id}`, type: 'sales_order', data: o, val: 3 });
      addLink(`so_${o.sales_order_id}`, `bill_${b.billing_id}`, 'billed_as');

      if (o.customer_id) {
        const c = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(o.customer_id) as Record<string, unknown> | undefined;
        if (c) {
          addNode({ id: `cust_${c.customer_id}`, label: String(c.customer_name || c.customer_id), type: 'customer', data: c, val: 2 });
          addLink(`cust_${c.customer_id}`, `so_${o.sales_order_id}`, 'placed');
        }
      }
    }
  }


  const items = db.prepare(
    `SELECT product_id
     FROM billing_items
     WHERE billing_id = ?
     LIMIT 200`
  ).all(b.billing_id as string) as Array<Record<string, unknown>>;

  const productIds = Array.from(new Set(items.map(it => (it.product_id ? String(it.product_id) : null)).filter(Boolean)));
  if (productIds.length > 0) {
    const productRows = db.prepare(
      `SELECT * FROM products WHERE product_id IN (${placeholders(productIds.length)})`
    ).all(productIds) as Array<Record<string, unknown>>;

    const productById = new Map<string, Record<string, unknown>>();
    for (const p of productRows) productById.set(String(p.product_id), p);

    for (const pid of productIds) {
      const p = productById.get(pid);
      addNode({ id: `prod_${pid}`, label: p ? String(p.product_name || pid) : pid, type: 'product', data: p || { product_id: pid }, val: 2 });
    }

    for (const it of items) {
      if (!it.product_id) continue;
      addLink(`bill_${b.billing_id}`, `prod_${it.product_id}`, 'billed_product');
    }
  }

  const journals = db.prepare(
    `SELECT * FROM journal_entries WHERE billing_id = ? OR reference_document = ?`
  ).all(b.billing_id as string, b.billing_id as string) as Array<Record<string, unknown>>;

  for (const j of journals) {
    addNode({ id: `je_${j.journal_id}`, label: `JE ${j.accounting_document || j.journal_id}`, type: 'journal', data: j, val: 3 });
    addLink(`bill_${b.billing_id}`, `je_${j.journal_id}`, 'recorded_in');
  }
}
