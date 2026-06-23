<?php
// ============================================================
//  IDNUK SOFTWARE - Orders API
//  Two phases of the daily order book:
//   1) SELL side — take phone orders from "Order Suppliers" (sales parties we sell
//      to at a fixed rate). Pick city -> order supplier -> products/bags/weight/notes
//      (rate optional). Aggregated demand per product is the day's summary. These are
//      PENDING and will later be converted to Sales bills.
//   2) BUY side  — against the aggregated demand, allocate where we'll procure each
//      product (e.g. 15 bags chillies = 3 @ SM + 4 @ TM + 8 @ AK). These are PENDING
//      and will later be converted to Supplier purchase bills.
//
//  GET  /api/orders?action=suppliers[&city_id]      - order suppliers (optionally by city)
//  GET  /api/orders?action=procure-parties          - purchase-side parties (for allocation)
//  POST /api/orders?action=save-order               - {id?, order_date, supplier_id, notes, items[]}
//  GET  /api/orders?action=orders[&date|&from&to]   - orders + items
//  POST /api/orders?action=delete-order             - {id}
//  GET  /api/orders?action=summary&date             - aggregated demand per product
//  GET  /api/orders?action=procurements&date        - allocations per product
//  POST /api/orders?action=save-procurement         - {order_date, product_id, allocations[]}
//  POST /api/orders?action=delete-procurement       - {id}
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'orders');
$db     = getDB();

// ---- Schema (idempotent) ----
migrateOnce('orders', 2, function ($db) {
    // Ensure the Order Supplier sales category exists (sort after the others).
    try {
        $db->prepare("INSERT IGNORE INTO party_categories (code, name_en, sort_order) VALUES ('ORDER_SUPPLIER','Order Supplier',7)")->execute();
    } catch (PDOException $e) {}

    $db->exec("CREATE TABLE IF NOT EXISTS orders (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_date  DATE NOT NULL,
        supplier_id INT UNSIGNED NOT NULL,
        notes       VARCHAR(255) NULL,
        status      VARCHAR(12) NOT NULL DEFAULT 'pending',
        created_by  INT UNSIGNED,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (order_date),
        INDEX idx_supplier (supplier_id),
        INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $db->exec("CREATE TABLE IF NOT EXISTS order_items (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_id    INT UNSIGNED NOT NULL,
        product_id  INT UNSIGNED NOT NULL,
        unit_type   VARCHAR(10) DEFAULT 'KG',
        no_of_bags  DECIMAL(10,2) DEFAULT 0,
        weight      DECIMAL(12,2) DEFAULT 0,
        rate        DECIMAL(12,2) NULL,
        notes       VARCHAR(255) NULL,
        INDEX idx_order (order_id),
        INDEX idx_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    // Buy-side allocation: where each product's demand is being procured.
    $db->exec("CREATE TABLE IF NOT EXISTS order_procurements (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_date      DATE NOT NULL,
        product_id      INT UNSIGNED NOT NULL,
        source_party_id INT UNSIGNED NOT NULL,
        no_of_bags      DECIMAL(10,2) DEFAULT 0,
        weight          DECIMAL(12,2) DEFAULT 0,
        rate            DECIMAL(12,2) NULL,
        notes           VARCHAR(255) NULL,
        status          VARCHAR(12) NOT NULL DEFAULT 'pending',
        created_by      INT UNSIGNED,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (order_date),
        INDEX idx_product (product_id),
        INDEX idx_source (source_party_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    // v2: orders flow into the existing pending queues. Link staged sales rows back to
    // their order so re-saving an order keeps its pending sales in sync (not duplicated).
    try { $db->exec("ALTER TABLE sales_staged_items ADD COLUMN order_id INT UNSIGNED NULL"); } catch (PDOException $e) {}

    // Supplier-side pending queue (mirror of sales_staged_items) — procurement allocations
    // land here as pending supplier-purchase lines, billed later from Supplier Purchase.
    $db->exec("CREATE TABLE IF NOT EXISTS supplier_staged_items (
        id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_date   DATE NOT NULL,
        party_id     INT UNSIGNED,
        party_name   VARCHAR(150),
        product_id   INT UNSIGNED,
        product_name VARCHAR(150),
        unit_type    VARCHAR(10) DEFAULT 'KG',
        no_of_bags   DECIMAL(10,2) DEFAULT 0,
        weight       DECIMAL(12,2) DEFAULT 0,
        rate         DECIMAL(12,2) NULL,
        is_billed    TINYINT(1) DEFAULT 0,
        bill_id      INT UNSIGNED NULL,
        created_by   INT UNSIGNED,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (order_date),
        INDEX idx_party (party_id),
        INDEX idx_billed (is_billed)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
});

// Push an order supplier's lines into the pending SALES queue (sales_staged_items), so
// they show under Sales -> Pending with all the existing billing features. Idempotent:
// if any line for this order is already billed we leave it untouched; otherwise we replace
// the order's unbilled staged rows with the current items.
function syncOrderToPendingSales(PDO $db, int $orderId, int $userId) {
    $o = $db->prepare("SELECT o.order_date, o.supplier_id, p.name_en AS supplier_name
                       FROM orders o JOIN parties p ON o.supplier_id = p.id WHERE o.id = ?");
    $o->execute([$orderId]);
    $ord = $o->fetch();
    if (!$ord) return;

    $billed = $db->prepare("SELECT COUNT(*) FROM sales_staged_items WHERE order_id = ? AND is_billed = 1");
    $billed->execute([$orderId]);
    if ((int)$billed->fetchColumn() > 0) return;   // already (partly) billed — don't disturb

    $db->prepare("DELETE FROM sales_staged_items WHERE order_id = ? AND is_billed = 0")->execute([$orderId]);

    $items = $db->prepare("SELECT oi.product_id, oi.no_of_bags, oi.weight, oi.rate, pr.name_en AS product_name
                           FROM order_items oi JOIN products pr ON oi.product_id = pr.id WHERE oi.order_id = ?");
    $items->execute([$orderId]);
    $ins = $db->prepare("INSERT INTO sales_staged_items
        (entry_date, vendor_id, vendor_name, product_id, product_name, no_of_bags, weight, rate, order_id, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)");
    foreach ($items->fetchAll() as $it) {
        $ins->execute([$ord['order_date'], $ord['supplier_id'], $ord['supplier_name'],
            $it['product_id'], $it['product_name'], (int)round((float)$it['no_of_bags']),
            round((float)$it['weight'], 2), $it['rate'] === null ? 0 : round((float)$it['rate'], 2),
            $orderId, $userId]);
    }
}

// Push a product's procurement allocations into the pending SUPPLIER queue. Idempotent per
// (date, product): billed lines are kept, the unbilled ones are replaced with current allocs.
function syncProductToPendingSupplier(PDO $db, string $date, int $productId, int $userId) {
    $billed = $db->prepare("SELECT COUNT(*) FROM supplier_staged_items WHERE order_date=? AND product_id=? AND is_billed=1");
    $billed->execute([$date, $productId]);
    if ((int)$billed->fetchColumn() > 0) return;

    $db->prepare("DELETE FROM supplier_staged_items WHERE order_date=? AND product_id=? AND is_billed=0")->execute([$date, $productId]);

    $pn = $db->prepare("SELECT name_en FROM products WHERE id=?");
    $pn->execute([$productId]);
    $productName = (string)($pn->fetchColumn() ?: '');

    $rows = $db->prepare("SELECT op.source_party_id, op.no_of_bags, op.weight, op.rate, p.name_en AS party_name
                          FROM order_procurements op JOIN parties p ON op.source_party_id = p.id
                          WHERE op.order_date=? AND op.product_id=?");
    $rows->execute([$date, $productId]);
    $ins = $db->prepare("INSERT INTO supplier_staged_items
        (order_date, party_id, party_name, product_id, product_name, no_of_bags, weight, rate, created_by)
        VALUES (?,?,?,?,?,?,?,?,?)");
    foreach ($rows->fetchAll() as $r) {
        $ins->execute([$date, $r['source_party_id'], $r['party_name'], $productId, $productName,
            round((float)$r['no_of_bags'], 2), round((float)$r['weight'], 2),
            $r['rate'] === null ? null : round((float)$r['rate'], 2), $userId]);
    }
}

// ---- GET: order suppliers (optionally filtered by city) ----
if ($method === 'GET' && $action === 'suppliers') {
    $cityId = getParam('city_id');
    $sql = "SELECT p.id, p.name_en, p.name_ta, p.phone1, p.city_id,
                   COALESCE(c.name_en, p.city) AS city_name
            FROM parties p
            JOIN party_categories pc ON p.category_id = pc.id
            LEFT JOIN cities c ON p.city_id = c.id
            WHERE pc.code = 'ORDER_SUPPLIER' AND p.is_active = 1";
    $params = [];
    if ($cityId !== null && $cityId !== '' && $cityId !== 'ALL') { $sql .= " AND p.city_id = ?"; $params[] = (int)$cityId; }
    $sql .= " ORDER BY p.name_en";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

// ---- GET: parties we buy the order stock from — Customers + Market Vendors ----
if ($method === 'GET' && $action === 'procure-parties') {
    $stmt = $db->query("SELECT p.id, p.name_en, p.name_ta, p.phone1, pc.code AS cat_code,
                               COALESCE(c.name_en, p.city) AS city_name
                        FROM parties p
                        JOIN party_categories pc ON p.category_id = pc.id
                        LEFT JOIN cities c ON p.city_id = c.id
                        WHERE pc.code IN ('CUSTOMER','MARKET_VENDOR') AND p.is_active = 1
                        ORDER BY p.name_en");
    respondList($stmt->fetchAll());
}

// ---- POST: save (or replace) an order supplier's order for a date ----
if ($method === 'POST' && $action === 'save-order') {
    $b    = getBody();
    $id   = (int)($b['id'] ?? 0);
    $sid  = (int)($b['supplier_id'] ?? 0);
    $date = $b['order_date'] ?? businessDate();
    if (!$sid) respondError('Order supplier required');
    assertDateUnlocked($date);

    // Clean the line items (a product with at least bags or weight is kept; rate optional).
    $items = is_array($b['items'] ?? null) ? $b['items'] : [];
    $clean = [];
    foreach ($items as $it) {
        $pid = (int)($it['product_id'] ?? 0);
        if (!$pid) continue;
        $bags = round((float)($it['no_of_bags'] ?? 0), 2);
        $wt   = round((float)($it['weight'] ?? 0), 2);
        if ($bags <= 0 && $wt <= 0) continue;
        $rate = ($it['rate'] === '' || $it['rate'] === null) ? null : round((float)$it['rate'], 2);
        $clean[] = ['product_id' => $pid, 'unit_type' => strtoupper($it['unit_type'] ?? 'KG'),
                    'no_of_bags' => $bags, 'weight' => $wt, 'rate' => $rate, 'notes' => $it['notes'] ?? null];
    }
    if (!$clean) respondError('Add at least one product with bags or weight');

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        if ($id) {
            $own = $db->prepare("SELECT id FROM orders WHERE id=?");
            $own->execute([$id]);
            if (!$own->fetch()) respondError('Order not found', 404);
            $db->prepare("UPDATE orders SET order_date=?, supplier_id=?, notes=? WHERE id=?")
               ->execute([$date, $sid, $b['notes'] ?? null, $id]);
            $db->prepare("DELETE FROM order_items WHERE order_id=?")->execute([$id]);
        } else {
            $db->prepare("INSERT INTO orders (order_date, supplier_id, notes, created_by) VALUES (?,?,?,?)")
               ->execute([$date, $sid, $b['notes'] ?? null, $user['id']]);
            $id = $db->lastInsertId();
        }
        $ins = $db->prepare("INSERT INTO order_items (order_id, product_id, unit_type, no_of_bags, weight, rate, notes)
                             VALUES (?,?,?,?,?,?,?)");
        foreach ($clean as $c) {
            $ins->execute([$id, $c['product_id'], $c['unit_type'], $c['no_of_bags'], $c['weight'], $c['rate'], $c['notes']]);
        }
        syncOrderToPendingSales($db, (int)$id, $user['id']);   // flow into pending Sales
        auditLog($b['id'] ?? null ? 'UPDATE' : 'CREATE', 'order', $id, "Order", ['supplier_id' => $sid, 'date' => $date, 'lines' => count($clean)]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['id' => $id]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to save order', $e);
    }
}

// ---- GET: orders for a date (or range) with their line items ----
if ($method === 'GET' && $action === 'orders') {
    $from = getParam('from', getParam('date', businessDate()));
    $to   = getParam('to',   getParam('date', $from));
    $sql = "SELECT o.id, o.order_date, o.supplier_id, o.notes, o.status,
                   p.name_en AS supplier_name, p.name_ta AS supplier_name_ta, p.city_id,
                   COALESCE(c.name_en, p.city) AS city_name
            FROM orders o
            JOIN parties p ON o.supplier_id = p.id
            LEFT JOIN cities c ON p.city_id = c.id
            WHERE o.order_date BETWEEN ? AND ? AND o.status <> 'cancelled'
            ORDER BY o.order_date DESC, o.id DESC";
    $stmt = $db->prepare($sql);
    $stmt->execute([$from, $to]);
    $list = $stmt->fetchAll();
    $ids = array_column($list, 'id');
    if ($ids) {
        $in = implode(',', array_fill(0, count($ids), '?'));
        $iq = $db->prepare("SELECT oi.*, pr.name_en AS product_name, pr.name_ta AS product_name_ta
                            FROM order_items oi JOIN products pr ON oi.product_id = pr.id
                            WHERE oi.order_id IN ($in) ORDER BY oi.id");
        $iq->execute($ids);
        $byO = [];
        foreach ($iq->fetchAll() as $it) { $byO[$it['order_id']][] = $it; }
        foreach ($list as &$row) { $row['items'] = $byO[$row['id']] ?? []; }
        unset($row);
    }
    respondList($list);
}

// ---- POST: delete an order ----
if ($method === 'POST' && $action === 'delete-order') {
    $b  = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    $row = $db->prepare("SELECT order_date FROM orders WHERE id=?");
    $row->execute([$id]);
    $o = $row->fetch();
    if (!$o) respondError('Not found', 404);
    assertDateUnlocked($o['order_date']);
    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // Pull this order's UNBILLED pending sales out of the queue too (billed ones stay).
        $db->prepare("DELETE FROM sales_staged_items WHERE order_id=? AND is_billed=0")->execute([$id]);
        $db->prepare("DELETE FROM order_items WHERE order_id=?")->execute([$id]);
        $db->prepare("DELETE FROM orders WHERE id=?")->execute([$id]);
        auditLog('DELETE', 'order', $id, "Deleted order", []);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['deleted' => $id]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to delete', $e);
    }
}

// ---- GET: aggregated demand per product for a date (the order summary) ----
if ($method === 'GET' && $action === 'summary') {
    $date = getParam('date', businessDate());
    $stmt = $db->prepare("SELECT oi.product_id, pr.name_en AS product_name, pr.name_ta AS product_name_ta, pr.unit_type,
                                 COALESCE(SUM(oi.no_of_bags),0) AS bags, COALESCE(SUM(oi.weight),0) AS weight,
                                 COUNT(DISTINCT o.supplier_id) AS suppliers
                          FROM order_items oi
                          JOIN orders o ON oi.order_id = o.id
                          JOIN products pr ON oi.product_id = pr.id
                          WHERE o.order_date = ? AND o.status <> 'cancelled'
                          GROUP BY oi.product_id, pr.name_en, pr.name_ta, pr.unit_type
                          ORDER BY pr.name_en");
    $stmt->execute([$date]);
    respondList($stmt->fetchAll());
}

// ---- GET: procurement allocations for a date (grouped per product) ----
if ($method === 'GET' && $action === 'procurements') {
    $date = getParam('date', businessDate());
    $stmt = $db->prepare("SELECT op.*, pr.name_en AS product_name, pr.name_ta AS product_name_ta,
                                 sp.name_en AS source_name, sp.name_ta AS source_name_ta
                          FROM order_procurements op
                          JOIN products pr ON op.product_id = pr.id
                          JOIN parties sp ON op.source_party_id = sp.id
                          WHERE op.order_date = ?
                          ORDER BY pr.name_en, op.id");
    $stmt->execute([$date]);
    respondList($stmt->fetchAll());
}

// ---- POST: save (replace) the allocation rows for one product on a date ----
if ($method === 'POST' && $action === 'save-procurement') {
    $b    = getBody();
    $date = $b['order_date'] ?? businessDate();
    $pid  = (int)($b['product_id'] ?? 0);
    if (!$pid) respondError('product_id required');
    assertDateUnlocked($date);

    $allocs = is_array($b['allocations'] ?? null) ? $b['allocations'] : [];
    $clean = [];
    foreach ($allocs as $a) {
        $src = (int)($a['source_party_id'] ?? 0);
        if (!$src) continue;
        $bags = round((float)($a['no_of_bags'] ?? 0), 2);
        $wt   = round((float)($a['weight'] ?? 0), 2);
        if ($bags <= 0 && $wt <= 0) continue;
        $rate = ($a['rate'] === '' || $a['rate'] === null) ? null : round((float)$a['rate'], 2);
        $clean[] = ['source_party_id' => $src, 'no_of_bags' => $bags, 'weight' => $wt, 'rate' => $rate, 'notes' => $a['notes'] ?? null];
    }

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // Replace this product's allocations for the date.
        $db->prepare("DELETE FROM order_procurements WHERE order_date=? AND product_id=?")->execute([$date, $pid]);
        $ins = $db->prepare("INSERT INTO order_procurements (order_date, product_id, source_party_id, no_of_bags, weight, rate, notes, created_by)
                             VALUES (?,?,?,?,?,?,?,?)");
        foreach ($clean as $c) {
            $ins->execute([$date, $pid, $c['source_party_id'], $c['no_of_bags'], $c['weight'], $c['rate'], $c['notes'], $user['id']]);
        }
        syncProductToPendingSupplier($db, $date, $pid, $user['id']);   // flow into pending Supplier purchases
        auditLog('UPDATE', 'order_procurement', $pid, "Order procurement allocation", ['date' => $date, 'product_id' => $pid, 'rows' => count($clean)]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['product_id' => $pid, 'rows' => count($clean)]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to save allocation', $e);
    }
}

// ---- POST: delete a single allocation row ----
if ($method === 'POST' && $action === 'delete-procurement') {
    $b  = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    $row = $db->prepare("SELECT order_date, product_id FROM order_procurements WHERE id=?");
    $row->execute([$id]);
    $o = $row->fetch();
    if (!$o) respondError('Not found', 404);
    assertDateUnlocked($o['order_date']);
    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $db->prepare("DELETE FROM order_procurements WHERE id=?")->execute([$id]);
        syncProductToPendingSupplier($db, $o['order_date'], (int)$o['product_id'], $user['id']);
        auditLog('DELETE', 'order_procurement', $id, "Deleted allocation", []);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['deleted' => $id]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to delete', $e);
    }
}

// ---- POST: clear ALL of one vendor's allocations on a date (from the vendor summary) ----
if ($method === 'POST' && $action === 'clear-procurement-source') {
    $b    = getBody();
    $date = $b['order_date'] ?? businessDate();
    $src  = (int)($b['source_party_id'] ?? 0);
    if (!$src) respondError('source_party_id required');
    assertDateUnlocked($date);
    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // Which products this vendor was allocated to (so we can re-sync their pending rows).
        $pq = $db->prepare("SELECT DISTINCT product_id FROM order_procurements WHERE order_date=? AND source_party_id=?");
        $pq->execute([$date, $src]);
        $pids = array_column($pq->fetchAll(), 'product_id');
        $db->prepare("DELETE FROM order_procurements WHERE order_date=? AND source_party_id=?")->execute([$date, $src]);
        foreach ($pids as $pid) { syncProductToPendingSupplier($db, $date, (int)$pid, $user['id']); }
        auditLog('DELETE', 'order_procurement', null, "Cleared vendor allocations", ['date' => $date, 'source_party_id' => $src, 'products' => count($pids)]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['cleared' => count($pids)]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to clear', $e);
    }
}

respondError('Invalid action', 400);
