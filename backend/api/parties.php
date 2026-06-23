<?php
// ============================================================
//  IDNUK SOFTWARE - Parties API
//  GET  /api/parties               - list (filter by category)
//  GET  /api/parties?action=get&id=
//  POST /api/parties?action=save   - create / update
//  GET  /api/parties?action=ledger&id=  - party ledger
//  GET  /api/parties?action=outstanding - vendor outstanding
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'list');
$db     = getDB();

// One-time migrations — run once and recorded in app_settings (was running ~14 DDL
// statements on every single request; see migrateOnce in helpers/api.php).
migrateOnce('parties', 2, function ($db) {   // v2: seed the ORDER_SUPPLIER category
    try { $db->exec("ALTER TABLE parties ADD COLUMN reference_id INT UNSIGNED NULL DEFAULT NULL"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE parties ADD COLUMN city_id INT UNSIGNED NULL DEFAULT NULL"); } catch (PDOException $e) {}

    // Performance indexes — important now that parties has thousands of rows
    foreach ([
        "ALTER TABLE parties ADD INDEX idx_cat_active (category_id, is_active)",
        "ALTER TABLE parties ADD INDEX idx_name_en (name_en)",
        "ALTER TABLE party_truck_links ADD INDEX idx_truck (truck_id)",
        "ALTER TABLE sales_bills ADD INDEX idx_party (party_id)",
        "ALTER TABLE sales_bills ADD INDEX idx_bal (is_cancelled, balance_due)",
        "ALTER TABLE sales_bills ADD INDEX idx_billdate (bill_date)",
        "ALTER TABLE ledger ADD INDEX idx_party_date (party_id, txn_date)",
        "ALTER TABLE ledger ADD INDEX idx_type_date (txn_type, txn_date)",
    ] as $ix) { try { $db->exec($ix); } catch (PDOException $e) {} }

    // Ensure party categories exist — ASCII only in PHP to avoid charset issues
    $catIns = $db->prepare("INSERT IGNORE INTO party_categories (code, name_en, sort_order) VALUES (?,?,?)");
    foreach ([
        ['FARMER',        'Farmer',          1],
        ['SUPPLIER',      'Supplier',        2],
        ['MARKET_VENDOR', 'Market Vendor',   3],
        ['CUSTOMER',      'Customer',        4],
        ['OVERFLOW',      'Overflow Vendor', 5],
        ['TRUCK',         'Truck/Reference', 6],
        ['ORDER_SUPPLIER','Order Supplier',  7],
    ] as [$code,$en,$sort]) {
        try { $catIns->execute([$code,$en,$sort]); } catch (PDOException $e) {}
    }

    // Convert all Tamil-storing tables to utf8mb4 (fix ???? on Namecheap latin1 default)
    foreach (['parties', 'party_categories', 'yard_entries'] as $tbl) {
        try { $db->exec("ALTER TABLE `$tbl` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); } catch (PDOException $e) {}
    }

    // Cities table — explicitly utf8mb4 so Tamil is stored correctly
    $db->exec("CREATE TABLE IF NOT EXISTS cities (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name_en     VARCHAR(100) NOT NULL,
        name_ta     VARCHAR(100),
        state       VARCHAR(50),
        sort_order  INT DEFAULT 0,
        is_active   TINYINT(1) DEFAULT 1,
        UNIQUE KEY uniq_name (name_en)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    try { $db->exec("ALTER TABLE cities CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); } catch (PDOException $e) {}

    $db->exec("CREATE TABLE IF NOT EXISTS party_truck_links (
        farmer_id INT UNSIGNED NOT NULL,
        truck_id  INT UNSIGNED NOT NULL,
        PRIMARY KEY (farmer_id, truck_id)
    )");
});

// ---- GET: List parties ----
if ($method === 'GET' && $action === 'list') {
    $category = getParam('category');
    $search   = getParam('search', '');
    $active   = getParam('active', '1');

    $truckId  = getParam('truck_id');
    $lite     = getParam('cols') === 'lite';   // slim payload for dropdowns
    if ($lite) {
        // Only the fields dropdowns need; skip the ref/city joins to cut cost + payload
        // (the WHERE clause is appended below from $where — don't add one here)
        $sql = "SELECT p.id, p.code, p.name_en, p.name_ta, p.city, p.phone1,
                       p.category_id, p.is_active, pc.code AS cat_code,
                       p.opening_balance, p.opening_bal_type
                FROM parties p
                JOIN party_categories pc ON p.category_id = pc.id";
    } else {
        $sql = "SELECT p.*, pc.code AS cat_code, pc.name_en AS cat_name, pc.name_ta AS cat_name_ta,
                       ref.name_en AS reference_name,
                       c.name_en AS city_name, c.name_ta AS city_name_ta
                FROM parties p
                JOIN party_categories pc ON p.category_id = pc.id
                LEFT JOIN parties ref ON p.reference_id = ref.id
                LEFT JOIN cities c ON p.city_id = c.id";
    }
    // Build the WHERE clause once so it can be reused for the COUNT (pagination).
    $where = " WHERE 1=1"; $params = [];
    if ($category) { $where .= " AND pc.code = ?"; $params[] = $category; }
    // cats=FARMER,SUPPLIER,... — multi-category filter (used by the Parties page tabs)
    $cats = array_values(array_filter(array_map('trim', explode(',', (string)getParam('cats', '')))));
    if ($cats) {
        $where .= " AND pc.code IN (" . implode(',', array_fill(0, count($cats), '?')) . ")";
        array_push($params, ...$cats);
    }
    if ($active !== 'all') { $where .= " AND p.is_active = ?"; $params[] = (int)$active; }
    if ($search) {
        $where .= " AND (p.name_en LIKE ? OR p.name_ta LIKE ? OR p.code LIKE ? OR p.phone1 LIKE ?)";
        $s = "%$search%";
        array_push($params, $s, $s, $s, $s);
    }
    if ($truckId) {
        $where .= " AND EXISTS (SELECT 1 FROM party_truck_links ptl WHERE ptl.farmer_id = p.id AND ptl.truck_id = ?)";
        $params[] = (int)$truckId;
    }

    $sql .= $where . " ORDER BY pc.sort_order, p.name_en";

    // Pagination is OPT-IN: only when ?limit= is sent (so dropdowns/exports still get all rows).
    $limitP = getParam('limit');
    if ($limitP !== null) {
        $limit  = max(1, min(500, (int)$limitP));
        $offset = max(0, (int)getParam('offset', 0));
        // total matching rows (for "showing X of Y" / load-more)
        $cnt = $db->prepare("SELECT COUNT(*) FROM parties p JOIN party_categories pc ON p.category_id = pc.id" . $where);
        $cnt->execute($params);
        $total = (int)$cnt->fetchColumn();
        $sql  .= " LIMIT $limit OFFSET $offset";
        $stmt  = $db->prepare($sql);
        $stmt->execute($params);
        respondList($stmt->fetchAll(), $total);
    } else {
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        respondList($stmt->fetchAll());
    }
}

// ---- GET: Single party ----
if ($method === 'GET' && $action === 'get') {
    $id = getParam('id');
    if (!$id) respondError('id required');
    $stmt = $db->prepare("SELECT p.*, pc.code AS cat_code, pc.name_en AS cat_name
                          FROM parties p
                          JOIN party_categories pc ON p.category_id = pc.id
                          WHERE p.id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) respondError('Party not found', 404);
    respond($row);
}

// ---- POST: Save party ----
if ($method === 'POST' && $action === 'save') {
    $b = getBody();
    if (empty($b['name_en']))      respondError('Name required');
    if (empty($b['category_id']))  respondError('Category required');

    // Resolve category_id — accept either category_id or category_code
    if (empty($b['category_id']) && !empty($b['category_code'])) {
        $cs = $db->prepare("SELECT id FROM party_categories WHERE code = ?");
        $cs->execute([strtoupper(trim((string)$b['category_code']))]);
        $found = $cs->fetchColumn();
        if ($found) $b['category_id'] = (int)$found;
    }
    if (empty($b['category_id'])) respondError('Category not found for code: ' . ($b['category_code'] ?? 'none'));

    // Resolve city name from city_id if provided (city is optional)
    $cityName = $b['city'] ?? null;
    if (!empty($b['city_id'])) {
        $cs = $db->prepare("SELECT name_en FROM cities WHERE id=?");
        $cs->execute([$b['city_id']]);
        $cityName = $cs->fetchColumn() ?: $cityName;
    }

    $fields = [
        'name_en'         => $b['name_en'],
        'name_ta'         => $b['name_ta']         ?? null,
        'category_id'     => $b['category_id'],
        'reference_id'    => !empty($b['reference_id']) ? (int)$b['reference_id'] : null,
        'city_id'         => !empty($b['city_id']) ? (int)$b['city_id'] : null,
        'phone1'          => $b['phone1']           ?? null,
        'phone2'          => $b['phone2']           ?? null,
        'address'         => $b['address']          ?? null,
        'city'            => $cityName,
        'area'            => $b['area']             ?? null,
        'pincode'         => $b['pincode']          ?? null,
        'gstin'           => $b['gstin']            ?? null,
        'credit_days'     => $b['credit_days']      ?? 14,
        'credit_limit'    => $b['credit_limit']     ?? 0,
        'opening_balance' => $b['opening_balance']  ?? 0,
        'opening_bal_type'=> $b['opening_bal_type'] ?? 'cr',
        'commission_pct'  => $b['commission_pct']   ?? 10,
        'is_active'       => $b['is_active']        ?? 1,
        'notes'           => $b['notes']            ?? null,
        'legacy_code'     => $b['legacy_code']      ?? null,
    ];

    if (!empty($b['id'])) {
        $sets   = implode(', ', array_map(fn($k) => "$k = ?", array_keys($fields)));
        $values = array_values($fields);
        $values[] = $b['id'];
        $db->prepare("UPDATE parties SET $sets, updated_at=NOW() WHERE id=?")->execute($values);
        $savedId = (int)$b['id'];
        $savedAction = 'updated';
    } else {
        // Auto-generate code if not provided
        if (empty($b['code'])) {
            $initials = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $b['name_en']), 0, 4));
            $count    = $db->query("SELECT COUNT(*) FROM parties")->fetchColumn();
            $b['code'] = $initials . str_pad($count + 1, 3, '0', STR_PAD_LEFT);
        }
        $fields['code'] = $b['code'];
        $cols         = implode(', ', array_keys($fields));
        $placeholders = implode(', ', array_fill(0, count($fields), '?'));
        $db->prepare("INSERT INTO parties ($cols) VALUES ($placeholders)")->execute(array_values($fields));
        $savedId = (int)$db->lastInsertId();
        $savedAction = 'created';
    }

    // Sync opening balance → OPENING ledger entry + OPEN- sales bill so outstanding reflects it.
    // Dr (they owe us) = debit ledger + unpaid OPEN- bill. Cr = credit ledger only (no receivable bill).
    $obAmt  = round((float)($b['opening_balance'] ?? 0), 2);
    $obType = ($b['opening_bal_type'] ?? 'cr') === 'dr' ? 'dr' : 'cr';

    // 1) OPENING ledger entry — upsert (delete old, insert fresh) so edits stay in sync.
    $db->prepare("DELETE FROM ledger WHERE txn_type='OPENING' AND ref_type='parties' AND party_id=?")->execute([$savedId]);
    if ($obAmt > 0) {
        $debit  = $obType === 'dr' ? $obAmt : 0;
        $credit = $obType === 'cr' ? $obAmt : 0;
        $db->prepare("INSERT INTO ledger
            (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
            VALUES (CURDATE(), 'OPENING', 'parties', ?, ?, 'Opening Balance', ?, ?, ?)")
           ->execute([$savedId, $savedId, $debit, $credit, $user['id']]);
    }

    // 2) OPEN- sales bill — only for Dr balances (vendor owes us); this makes it appear in
    //    vw_vendor_outstanding so the sales bill form shows the correct Previous Balance.
    $existingOpen = $db->prepare("SELECT id FROM sales_bills WHERE party_id=? AND bill_no LIKE 'OPEN-%' LIMIT 1");
    $existingOpen->execute([$savedId]);
    $openBillId = $existingOpen->fetchColumn();

    if ($obType === 'dr' && $obAmt > 0) {
        if ($openBillId) {
            // Update existing OPEN- bill amount.
            $db->prepare("UPDATE sales_bills SET subtotal_amount=?, net_amount=?, balance_due=?,
                          payment_status=IF(balance_due>0,'unpaid','paid') WHERE id=?")
               ->execute([$obAmt, $obAmt, $obAmt, $openBillId]);
        } else {
            // Create a new OPEN- bill.
            $openSeq = (int)$db->query("SELECT COALESCE(MAX(CAST(SUBSTRING(bill_no,6) AS UNSIGNED)),0)
                                        FROM sales_bills WHERE bill_no LIKE 'OPEN-%'")->fetchColumn();
            $openBn  = 'OPEN-' . str_pad($openSeq + 1, 5, '0', STR_PAD_LEFT);
            $today   = date('Y-m-d');
            $db->prepare("INSERT INTO sales_bills
                (bill_no, bill_date, bill_time, party_id, credit_days, due_date,
                 subtotal_weight, subtotal_amount, discount_amt, total_sakku_amt, total_cooly_amt,
                 net_amount, balance_due, payment_status, notes, created_by)
                VALUES (?,?,NOW(),?,0,?,0,?,0,0,0,?,?,'unpaid',?,?)")
               ->execute([$openBn, $today, $savedId, $today, $obAmt, $obAmt, $obAmt,
                          'Opening balance', $user['id']]);
        }
    } elseif ($openBillId) {
        // Balance removed or switched to Cr — zero out the OPEN- bill.
        $db->prepare("UPDATE sales_bills SET balance_due=0, payment_status='paid' WHERE id=?")
           ->execute([$openBillId]);
    }

    // Update truck links for farmers/suppliers
    if (isset($b['truck_ids'])) {
        $db->prepare("DELETE FROM party_truck_links WHERE farmer_id=?")->execute([$savedId]);
        if (!empty($b['truck_ids']) && is_array($b['truck_ids'])) {
            $ins = $db->prepare("INSERT IGNORE INTO party_truck_links (farmer_id, truck_id) VALUES (?,?)");
            foreach ($b['truck_ids'] as $tid) { if ($tid) $ins->execute([$savedId, (int)$tid]); }
        }
    }
    auditLog($savedAction === 'updated' ? 'UPDATE' : 'CREATE', 'party', $savedId, $b['name_en'] ?? "Party #$savedId", ['name' => $b['name_en'] ?? null, 'category' => $b['category_code'] ?? $b['category_id'] ?? null, 'phone' => $b['phone1'] ?? null]);
    respond(['id' => $savedId, 'action' => $savedAction, 'code' => $b['code'] ?? null]);
}

// ---- GET: Party ledger ----
if ($method === 'GET' && $action === 'ledger') {
    $id      = getParam('id');
    $from    = getParam('from', date('Y-m-01'));
    $to      = getParam('to',   date('Y-m-d'));
    if (!$id) respondError('id required');

    $stmt = $db->prepare("
        SELECT l.*, u.username AS created_by_name
        FROM ledger l
        LEFT JOIN users u ON l.created_by = u.id
        WHERE l.party_id = ? AND l.txn_date BETWEEN ? AND ?
        ORDER BY l.txn_date, l.id
    ");
    $stmt->execute([$id, $from, $to]);
    $rows = $stmt->fetchAll();

    // Running balance
    $balance = 0;
    foreach ($rows as &$row) {
        $balance += $row['debit'] - $row['credit'];
        $row['running_balance'] = $balance;
    }

    respondList($rows);
}

// ---- GET: Vendor outstanding with aging ----
if ($method === 'GET' && $action === 'outstanding') {
    $partyId       = getParam('party_id');
    $excludeBillId = getParam('exclude_bill_id');
    $sql = "SELECT sb.id, sb.party_id, sb.bill_no, sb.bill_date, sb.due_date,
                   sb.balance_due,
                   GREATEST(0, DATEDIFF(CURDATE(), sb.due_date)) AS days_overdue,
                   p.name_en AS vendor_name, p.name_ta AS vendor_name_ta, p.phone1, p.city
            FROM sales_bills sb
            JOIN parties p ON sb.party_id = p.id
            WHERE sb.is_cancelled = 0
              AND sb.payment_status NOT IN ('paid','cancelled')
              AND sb.balance_due > 0";
    $params = [];
    if ($partyId)       { $sql .= " AND sb.party_id = ?"; $params[] = $partyId; }
    if ($excludeBillId) { $sql .= " AND sb.id != ?";      $params[] = (int)$excludeBillId; }
    $sql .= " ORDER BY days_overdue DESC";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $rows   = $stmt->fetchAll();
    $totals = ['total_outstanding' => 0, 'overdue_count' => 0, 'current_count' => 0];
    foreach ($rows as $r) {
        $totals['total_outstanding'] += $r['balance_due'];
        if ($r['days_overdue'] > 0) $totals['overdue_count']++;
        else $totals['current_count']++;
    }

    http_response_code(200);
    echo json_encode(['success' => true, 'data' => $rows, 'totals' => $totals], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Categories list ----
if ($method === 'GET' && $action === 'categories') {
    $stmt = $db->query("SELECT * FROM party_categories ORDER BY sort_order");
    respondList($stmt->fetchAll());
}

// ---- GET: List cities ----
if ($method === 'GET' && $action === 'list-cities') {
    $stmt = $db->query("SELECT * FROM cities WHERE is_active=1 ORDER BY sort_order, name_en");
    respondList($stmt->fetchAll());
}

// ---- POST: Add city ----
if ($method === 'POST' && $action === 'add-city') {
    $b = getBody();
    if (empty($b['name_en'])) respondError('City name required');
    $db->prepare("INSERT IGNORE INTO cities (name_en, name_ta) VALUES (?,?)")
       ->execute([trim($b['name_en']), $b['name_ta'] ?? null]);
    $id = $db->lastInsertId() ?: $db->query("SELECT id FROM cities WHERE name_en=" . $db->quote(trim($b['name_en'])))->fetchColumn();
    respond(['id' => $id, 'name_en' => trim($b['name_en']), 'name_ta' => $b['name_ta'] ?? null]);
}

// ---- GET: Trucks linked to a farmer ----
if ($method === 'GET' && $action === 'get-trucks') {
    $id = getParam('id');
    if (!$id) respondError('id required');
    $stmt = $db->prepare("SELECT p.id, p.name_en, p.name_ta FROM party_truck_links ptl JOIN parties p ON ptl.truck_id = p.id WHERE ptl.farmer_id=?");
    $stmt->execute([$id]);
    respondList($stmt->fetchAll());
}

// ---- GET: Farmers linked to a truck ----
if ($method === 'GET' && $action === 'get-truck-farmers') {
    $id = getParam('id');
    if (!$id) respondError('id required');
    $stmt = $db->prepare("SELECT p.id, p.name_en, p.name_ta, p.city FROM party_truck_links ptl JOIN parties p ON ptl.farmer_id = p.id WHERE ptl.truck_id=? ORDER BY p.name_en");
    $stmt->execute([$id]);
    respondList($stmt->fetchAll());
}

// ---- POST: Assign a set of farmers to a truck (bulk) ----
// body: { truck_id, farmer_ids:[...], mode?: 'replace'|'add' }
if ($method === 'POST' && $action === 'set-truck-farmers') {
    $b = getBody();
    $truckId = (int)($b['truck_id'] ?? 0);
    if (!$truckId) respondError('truck_id required');
    $ids  = array_values(array_unique(array_filter(array_map('intval', $b['farmer_ids'] ?? []))));
    $mode = ($b['mode'] ?? 'replace') === 'add' ? 'add' : 'replace';

    if ($mode === 'replace') {
        $db->prepare("DELETE FROM party_truck_links WHERE truck_id=?")->execute([$truckId]);
    }
    if ($ids) {
        $ins = $db->prepare("INSERT IGNORE INTO party_truck_links (farmer_id, truck_id) VALUES (?,?)");
        foreach ($ids as $fid) $ins->execute([$fid, $truckId]);
    }
    $total = $db->prepare("SELECT COUNT(*) FROM party_truck_links WHERE truck_id=?");
    $total->execute([$truckId]);
    respond(['truck_id' => $truckId, 'linked' => (int)$total->fetchColumn(), 'action' => 'saved']);
}

// ---- POST: Delete city ----
if ($method === 'POST' && $action === 'delete-city') {
    $b = getBody();
    if (empty($b['id'])) respondError('id required');
    $db->prepare("DELETE FROM cities WHERE id=?")->execute([(int)$b['id']]);
    respond(['id' => $b['id'], 'action' => 'deleted']);
}

// ---- POST: Delete truck (remove links + deactivate) ----
if ($method === 'POST' && $action === 'delete-truck') {
    $b = getBody();
    if (empty($b['id'])) respondError('id required');
    $db->prepare("DELETE FROM party_truck_links WHERE truck_id=?")->execute([(int)$b['id']]);
    $db->prepare("UPDATE parties SET is_active=0 WHERE id=?")->execute([(int)$b['id']]);
    respond(['id' => $b['id'], 'action' => 'deleted']);
}

// ---- POST: Deactivate party (soft delete) ----
if ($method === 'POST' && $action === 'deactivate') {
    $b  = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');

    // Block deactivation if any unsettled balance exists
    $party = $db->prepare("SELECT opening_balance, opening_bal_type FROM parties WHERE id=?");
    $party->execute([$id]);
    $p = $party->fetch();

    $salesBal = $db->prepare("SELECT COALESCE(SUM(balance_due),0) FROM sales_bills WHERE party_id=? AND is_cancelled=0 AND balance_due>0");
    $salesBal->execute([$id]);
    $salesOwed = (float)$salesBal->fetchColumn();

    $purBal = $db->prepare("SELECT COALESCE(SUM(net_payable),0) FROM purchase_bills WHERE party_id=? AND is_cancelled=0 AND payment_status IN ('unpaid','partial')");
    $purBal->execute([$id]);
    $purOwed = (float)$purBal->fetchColumn();

    $openingBal = $p ? abs((float)($p['opening_balance'] ?? 0)) : 0;

    $totalOutstanding = $salesOwed + $purOwed + $openingBal;
    if ($totalOutstanding > 0) {
        $parts = [];
        if ($salesOwed  > 0) $parts[] = "sales outstanding ₹" . number_format($salesOwed, 2);
        if ($purOwed    > 0) $parts[] = "purchase dues ₹"    . number_format($purOwed,   2);
        if ($openingBal > 0) $parts[] = "opening balance ₹"  . number_format($openingBal, 2);
        respondError('Cannot deactivate: party has an unsettled balance (' . implode(', ', $parts) . '). Clear all dues first.', 409);
    }

    $db->prepare("UPDATE parties SET is_active=0 WHERE id=?")->execute([$id]);
    auditLog('DELETE', 'party', $id, "Deactivated party", null);
    respond(['id' => $id, 'action' => 'deactivated']);
}

// ---- POST: Bulk re-type parties (move selected parties to a different category) ----
// body: { ids:[..], category_id? | category_code? }. Only the category changes —
// names, balances, ledger history are untouched.
if ($method === 'POST' && $action === 'set-category') {
    $b   = getBody();
    $ids = array_values(array_unique(array_filter(array_map('intval', (array)($b['ids'] ?? [])))));
    if (!$ids) respondError('Select at least one party');

    // Resolve the target category from id or code, and confirm it exists.
    $catId = (int)($b['category_id'] ?? 0);
    if (!$catId && !empty($b['category_code'])) {
        $st = $db->prepare("SELECT id FROM party_categories WHERE code = ?");
        $st->execute([$b['category_code']]);
        $catId = (int)$st->fetchColumn();
    }
    if (!$catId) respondError('Target category required');
    $catSt = $db->prepare("SELECT code, name_en FROM party_categories WHERE id = ?");
    $catSt->execute([$catId]);
    $cat = $catSt->fetch();
    if (!$cat) respondError('Target category not found');

    $in  = implode(',', array_fill(0, count($ids), '?'));
    $upd = $db->prepare("UPDATE parties SET category_id = ? WHERE id IN ($in)");
    $upd->execute(array_merge([$catId], $ids));

    auditLog('UPDATE', 'party', null,
        "Re-typed " . count($ids) . " parties → {$cat['code']}",
        ['ids' => $ids, 'to_category' => $cat['code']]);
    respond(['updated' => $upd->rowCount(), 'category_id' => $catId, 'category_code' => $cat['code']]);
}

// ---- POST: Add truck (creates TRUCK category if missing) ----
if ($method === 'POST' && $action === 'add-truck') {
    $b = getBody();
    if (empty($b['name_en'])) respondError('Truck name required');

    // Get or create TRUCK category
    $stmt = $db->query("SELECT id FROM party_categories WHERE code='TRUCK'");
    $cat  = $stmt->fetch();
    if (!$cat) {
        $db->exec("INSERT INTO party_categories (code, name_en, name_ta, sort_order) VALUES ('TRUCK','Truck / Reference','டிரக்',5)");
        $truckCatId = $db->lastInsertId();
    } else {
        $truckCatId = $cat['id'];
    }

    $initials = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $b['name_en']), 0, 4));
    $count    = $db->query("SELECT COUNT(*) FROM parties")->fetchColumn();
    $code     = $initials . str_pad($count + 1, 3, '0', STR_PAD_LEFT);

    $db->prepare("INSERT INTO parties (code, name_en, name_ta, category_id, is_active) VALUES (?,?,?,?,1)")
       ->execute([$code, $b['name_en'], $b['name_ta'] ?? null, $truckCatId]);
    respond(['id' => $db->lastInsertId(), 'code' => $code, 'action' => 'created']);
}

// ---- GET: Market vendor weekly tally ----
if ($method === 'GET' && $action === 'vendor-tally') {
    $from = getParam('from', date('Y-m-d', strtotime('last sunday')));
    $to   = getParam('to',   date('Y-m-d'));

    $stmt = $db->prepare("
        SELECT p.id, p.name_en, p.name_ta, p.phone1
        FROM parties p JOIN party_categories pc ON p.category_id = pc.id
        WHERE pc.code = 'MARKET_VENDOR' AND p.is_active = 1
        ORDER BY p.name_en
    ");
    $stmt->execute();
    $vendors = $stmt->fetchAll();

    $result = [];
    foreach ($vendors as $v) {
        $ps = $db->prepare("SELECT COALESCE(SUM(net_payable),0) FROM purchase_bills WHERE party_id=? AND bill_date BETWEEN ? AND ? AND is_cancelled=0");
        $ps->execute([$v['id'], $from, $to]);
        $purchases = (float)$ps->fetchColumn();

        $ss = $db->prepare("SELECT COALESCE(SUM(net_amount),0) FROM sales_bills WHERE party_id=? AND bill_date BETWEEN ? AND ? AND is_cancelled=0");
        try { $ss->execute([$v['id'], $from, $to]); $sales = (float)$ss->fetchColumn(); }
        catch (PDOException $e) { $sales = 0; }

        $result[] = ['party_id'=>$v['id'], 'name_en'=>$v['name_en'], 'name_ta'=>$v['name_ta'],
                     'phone1'=>$v['phone1'], 'purchases'=>$purchases, 'sales'=>$sales,
                     'net'=>round($sales - $purchases, 2)];
    }
    http_response_code(200);
    echo json_encode(['success'=>true, 'data'=>$result, 'from'=>$from, 'to'=>$to], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Transliterate English → Tamil ----
if ($method === 'GET' && $action === 'transliterate') {
    $text = trim(getParam('text', ''));
    if (!$text) { respond(['result' => '']); }

    $url  = 'https://inputtools.google.com/request?' . http_build_query([
        'text' => $text, 'itc' => 'ta-t-i0-und', 'num' => 1, 'cp' => 0, 'cs' => 1, 'ie' => 'utf-8', 'oe' => 'utf-8'
    ]);
    $result = '';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 4,
            CURLOPT_USERAGENT => 'Mozilla/5.0', CURLOPT_SSL_VERIFYPEER => false]);
        $raw = curl_exec($ch);
        curl_close($ch);
        if ($raw) {
            $data = json_decode($raw, true);
            if (isset($data[0]) && $data[0] === 'SUCCESS' && !empty($data[1])) {
                $parts = [];
                foreach ($data[1] as $word) { if (!empty($word[1][0])) $parts[] = $word[1][0]; }
                $result = implode(' ', $parts);
            }
        }
    }
    respond(['result' => $result]);
}

respondError('Invalid action', 400);
