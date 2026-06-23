<?php
// ============================================================
//  IDNUK SOFTWARE - Products & Daily Rates API
//  GET    /api/products            - list all products
//  GET    /api/products/rates      - today's rates
//  POST   /api/products/rates      - set today's rates
//  GET    /api/products/rate-history?product_id=&days=30
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'list');
$db     = getDB();

// Idempotent: convert product tables to utf8mb4 so Tamil names store correctly
// (Namecheap MySQL defaults tables to latin1, which turns Tamil into "????").
// Existing corrupted rows must be re-saved; future saves will be correct.
migrateOnce('products', 1, function ($db) {
    try { $db->exec("ALTER TABLE products CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE product_categories CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); } catch (PDOException $e) {}
});

// ---- GET: List products. Default = active only (used by every product picker, so
//      disabled products never appear there). Pass ?all=1 for the Products management
//      screen, which needs to see disabled ones to re-enable them. ----
if ($method === 'GET' && $action === 'list') {
    $all = getParam('all') === '1';
    $where = $all ? '' : 'WHERE p.is_active = 1';
    $stmt = $db->query("
        SELECT p.id, p.code, p.name_en, p.name_ta, p.unit_type, p.category_id,
               p.bag_deduction_kg, p.vendor_short_kg, p.is_active, p.sort_order,
               pc.name_en AS category_name, pc.name_ta AS category_name_ta
        FROM products p
        LEFT JOIN product_categories pc ON p.category_id = pc.id
        $where
        ORDER BY p.is_active DESC, p.sort_order, p.name_en
    ");
    respondList($stmt->fetchAll());
}

// ---- POST: enable/disable a product (kept out of pickers, history preserved) ----
if ($method === 'POST' && $action === 'set-active') {
    $b  = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    $active = !empty($b['is_active']) ? 1 : 0;
    $db->prepare("UPDATE products SET is_active=? WHERE id=?")->execute([$active, $id]);
    auditLog('UPDATE', 'product', $id, ($active ? 'Enabled' : 'Disabled') . ' product', ['is_active' => $active]);
    respond(['id' => $id, 'is_active' => $active]);
}

// ---- GET: Today's rates ----
if ($method === 'GET' && $action === 'rates') {
    $date = getParam('date', date('Y-m-d'));
    $stmt = $db->prepare("
        SELECT p.id AS product_id, p.code, p.name_en, p.name_ta, p.unit_type,
               p.bag_deduction_kg, p.vendor_short_kg,
               dr.id AS rate_id, dr.market_rate, dr.min_rate, dr.max_rate, dr.notes
        FROM products p
        LEFT JOIN daily_rates dr ON dr.product_id = p.id AND dr.rate_date = ?
        WHERE p.is_active = 1
        ORDER BY p.sort_order, p.name_en
    ");
    $stmt->execute([$date]);
    respondList($stmt->fetchAll());
}

// ---- POST: Set/update today's rates (bulk) ----
if ($method === 'POST' && $action === 'rates') {
    $body  = getBody();
    $date  = $body['date'] ?? date('Y-m-d');
    $rates = $body['rates'] ?? [];

    if (empty($rates)) respondError('No rates provided');

    $stmt = $db->prepare("
        INSERT INTO daily_rates (rate_date, product_id, market_rate, min_rate, max_rate, notes, set_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            market_rate = VALUES(market_rate),
            min_rate    = VALUES(min_rate),
            max_rate    = VALUES(max_rate),
            notes       = VALUES(notes),
            set_by      = VALUES(set_by)
    ");

    $saved = 0;
    foreach ($rates as $r) {
        if (empty($r['product_id']) || !isset($r['market_rate'])) continue;
        $stmt->execute([
            $date,
            $r['product_id'],
            $r['market_rate'],
            $r['min_rate']    ?? null,
            $r['max_rate']    ?? null,
            $r['notes']       ?? null,
            $user['id']
        ]);
        $saved++;
    }
    respond(['saved' => $saved, 'date' => $date]);
}

// ---- GET: Rate history for a product ----
if ($method === 'GET' && $action === 'rate-history') {
    $productId = getParam('product_id');
    $days      = (int) getParam('days', 30);
    if (!$productId) respondError('product_id required');

    $stmt = $db->prepare("
        SELECT dr.rate_date, dr.market_rate, dr.min_rate, dr.max_rate,
               p.name_en, p.name_ta
        FROM daily_rates dr
        JOIN products p ON dr.product_id = p.id
        WHERE dr.product_id = ?
          AND dr.rate_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        ORDER BY dr.rate_date DESC
    ");
    $stmt->execute([$productId, $days]);
    respondList($stmt->fetchAll());
}

// ---- GET: Purchase history for a product (per-day bags / weight / rate) ----
if ($method === 'GET' && $action === 'purchase-history') {
    $productId = getParam('product_id');
    $days      = (int) getParam('days', 90);
    if (!$productId) respondError('product_id required');

    $stmt = $db->prepare("
        SELECT pb.bill_date,
               SUM(pi.no_of_bags)                          AS total_bags,
               ROUND(SUM(pi.billed_weight), 2)             AS total_weight,
               ROUND(AVG(pi.purchase_rate), 2)             AS avg_rate,
               MIN(pi.purchase_rate)                       AS min_rate,
               MAX(pi.purchase_rate)                       AS max_rate,
               ROUND(SUM(pi.gross_amount), 2)              AS total_amount,
               COUNT(DISTINCT pb.id)                       AS bill_count
        FROM purchase_items pi
        JOIN purchase_bills pb ON pi.bill_id = pb.id
        WHERE pi.product_id = ?
          AND pb.is_cancelled = 0
          AND pb.bill_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY pb.bill_date
        ORDER BY pb.bill_date
    ");
    $stmt->execute([$productId, $days]);
    respondList($stmt->fetchAll());
}

// ---- GET: Categories ----
if ($method === 'GET' && $action === 'categories') {
    $stmt = $db->query("SELECT * FROM product_categories ORDER BY sort_order");
    respondList($stmt->fetchAll());
}

// ---- POST: Add/Edit product ----
if ($method === 'POST' && $action === 'save') {
    $b = getBody();
    if (empty($b['name_en'])) respondError('Product name required');

    if (!empty($b['id'])) {
        $stmt = $db->prepare("UPDATE products SET
            name_en=?, name_ta=?, category_id=?, unit_type=?,
            bag_deduction_kg=?, vendor_short_kg=?, is_active=?, sort_order=?
            WHERE id=?");
        $stmt->execute([
            $b['name_en'], $b['name_ta'] ?? null, $b['category_id'] ?? null,
            $b['unit_type'] ?? 'KG', $b['bag_deduction_kg'] ?? 3,
            $b['vendor_short_kg'] ?? 1, $b['is_active'] ?? 1,
            $b['sort_order'] ?? 0, $b['id']
        ]);
        auditLog('UPDATE', 'product', $b['id'], $b['name_en'], ['name' => $b['name_en'], 'unit' => $b['unit_type'] ?? 'KG']);
        respond(['id' => $b['id'], 'action' => 'updated']);
    } else {
        $stmt = $db->prepare("INSERT INTO products
            (code, name_en, name_ta, category_id, unit_type, bag_deduction_kg, vendor_short_kg, sort_order)
            VALUES (?,?,?,?,?,?,?,?)");
        $stmt->execute([
            strtoupper($b['code'] ?? substr(preg_replace('/\s+/', '', $b['name_en']), 0, 10)),
            $b['name_en'], $b['name_ta'] ?? null, $b['category_id'] ?? null,
            $b['unit_type'] ?? 'KG', $b['bag_deduction_kg'] ?? 3,
            $b['vendor_short_kg'] ?? 1, $b['sort_order'] ?? 0
        ]);
        $newId = $db->lastInsertId();
        auditLog('CREATE', 'product', $newId, $b['name_en'], ['name' => $b['name_en'], 'unit' => $b['unit_type'] ?? 'KG']);
        respond(['id' => $newId, 'action' => 'created']);
    }
}

respondError('Invalid action', 400);
