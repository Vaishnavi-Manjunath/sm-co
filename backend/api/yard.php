<?php
// ============================================================
//  IDNUK SOFTWARE - Yard Entry API
//  POST /api/yard.php?action=save
//  GET  /api/yard.php?action=list&date=&ref=
//  POST /api/yard.php?action=mark-billed
// ============================================================
require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'list');
$db     = getDB();

// Create yard_entries table if not exists
// One-time migrations (recorded in app_settings; bump the version to add more)
migrateOnce('yard', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS yard_entries (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        entry_date      DATE NOT NULL,
        reference_name  VARCHAR(100),
        farmer_id       INT UNSIGNED,
        farmer_name     VARCHAR(150),
        farmer_name_ta  VARCHAR(150),
        town            VARCHAR(100),
        items_json      MEDIUMTEXT COMMENT 'JSON array of items with weights',
        total_net_weight DECIMAL(10,2) DEFAULT 0,
        item_count      INT DEFAULT 0,
        is_billed       TINYINT(1) DEFAULT 0,
        purchase_bill_id INT UNSIGNED,
        created_by      INT UNSIGNED,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (entry_date),
        INDEX idx_ref (reference_name),
        INDEX idx_farmer (farmer_id)
    )");
    // Per-entry freight (carried into the purchase bill).
    // freight_mode = 'auto' (weight × 0.5) or 'manual' (typed value).
    try { $db->exec("ALTER TABLE yard_entries ADD COLUMN freight DECIMAL(10,2) NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE yard_entries ADD COLUMN freight_mode VARCHAR(10) NULL DEFAULT 'auto'"); } catch (PDOException $e) {}

    // yard_allocations: each row = bags of one product from one yard entry assigned to one
    // vendor. vendor_id NULL means unsold; unallocated bags (entry bags - SUM allocated) are stock.
    $db->exec("CREATE TABLE IF NOT EXISTS yard_allocations (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        yard_entry_id   INT UNSIGNED NOT NULL,
        entry_date      DATE NOT NULL,
        reference_name  VARCHAR(100),
        farmer_id       INT UNSIGNED,
        farmer_name     VARCHAR(150),
        product_id      INT UNSIGNED,
        product_name    VARCHAR(150),
        vendor_id       INT UNSIGNED NULL,
        vendor_name     VARCHAR(150),
        no_of_bags      INT DEFAULT 1,
        weight          DECIMAL(10,2) DEFAULT 0,
        bag_weights_json VARCHAR(255),
        is_billed       TINYINT(1) DEFAULT 0,
        sales_bill_id   INT UNSIGNED NULL,
        sales_item_id   INT UNSIGNED NULL,
        created_by      INT UNSIGNED,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (entry_date),
        INDEX idx_vendor (vendor_id),
        INDEX idx_entry (yard_entry_id),
        INDEX idx_billed (is_billed)
    )");
});

// ---- GET: List yard entries ----
if ($method === 'GET' && $action === 'list') {
    $date = getParam('date', date('Y-m-d'));
    $ref  = getParam('ref', '');

    $sql = "SELECT ye.*,
                   p.name_en AS farmer_name_db, p.name_ta AS farmer_name_ta_db
            FROM yard_entries ye
            LEFT JOIN parties p ON ye.farmer_id = p.id
            WHERE ye.entry_date = ?";
    $params = [$date];
    if ($ref === 'DIRECT') {
        $sql .= " AND (ye.reference_name = '' OR ye.reference_name IS NULL)";
    } elseif ($ref) {
        $sql .= " AND ye.reference_name = ?"; $params[] = $ref;
    }
    $sql .= " ORDER BY ye.id DESC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // Parse items JSON + add billed status
    foreach ($rows as &$row) {
        $row['items']    = json_decode($row['items_json'] ?? '[]', true);
        $row['billed']   = (bool)$row['is_billed'];
        $row['farmer_name'] = $row['farmer_name'] ?: $row['farmer_name_db'];
        $row['farmer_name_ta'] = $row['farmer_name_ta'] ?: $row['farmer_name_ta_db'];
    }
    respondList($rows);
}

// ---- POST: Save yard entry ----
if ($method === 'POST' && $action === 'save') {
    $b = getBody();

    if (empty($b['farmer_id']))   respondError('Farmer required');
    if (empty($b['items']))       respondError('At least one item required');

    $entryDate = $b['entry_date'] ?? businessDate();
    assertDateUnlocked($entryDate);

    // Calculate total net weight
    $totalNet = 0;
    $items = [];
    foreach ($b['items'] as $item) {
        $weights  = $item['weights'] ?? [];
        $bags     = intval($item['bags'] ?? 0);
        $raw      = array_sum(array_map('floatval', $weights));
        $deduct   = 0; // No auto deduction — net is the actual weighed weight
        $net      = max(0, round($raw - $deduct, 2));
        $totalNet += $net;

        $items[] = [
            'product_id'   => $item['product_id'],
            'product_name' => $item['product_name'] ?? '',
            'bags'         => $bags,
            'weights'      => $weights,
            'raw_weight'   => $raw,
            'deduction'    => $deduct,
            'net_weight'   => $net,
        ];
    }

    // Freight: 'auto' = weight × the configurable per-kg rate (computed here, authoritative);
    // 'manual' = the typed value. Rate lives in Business Rules (Users/Admin).
    $freightMode = (($b['freight_mode'] ?? 'auto') === 'manual') ? 'manual' : 'auto';
    $freight = $freightMode === 'auto'
        ? round($totalNet * (float)businessRules()['freight_per_kg'], 2)
        : round((float)($b['freight'] ?? 0), 2);

    $stmt = $db->prepare("INSERT INTO yard_entries
        (entry_date, reference_name, farmer_id, farmer_name, farmer_name_ta, town,
         items_json, total_net_weight, item_count, freight, freight_mode, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    $stmt->execute([
        $entryDate,
        ($b['reference'] === 'DIRECT' ? '' : ($b['reference'] ?? '')),
        $b['farmer_id'],
        $b['farmer_name'] ?? '',
        $b['farmer_name_ta'] ?? '',
        $b['town'] ?? '',
        json_encode($items, JSON_UNESCAPED_UNICODE),
        $totalNet,
        count($items),
        $freight,
        $freightMode,
        $user['id']
    ]);

    respond([
        'id'               => $db->lastInsertId(),
        'total_net_weight' => $totalNet,
        'item_count'       => count($items),
        'freight'          => $freight,
    ]);
}

// ---- POST: Mark as billed ----
if ($method === 'POST' && $action === 'mark-billed') {
    $b = getBody();
    if (empty($b['id'])) respondError('id required');
    $db->prepare("UPDATE yard_entries SET is_billed=1, purchase_bill_id=? WHERE id=?")
       ->execute([$b['bill_id'] ?? null, $b['id']]);
    respond(['id' => $b['id']]);
}

// ---- GET: Reference summary ----
if ($method === 'GET' && $action === 'ref-summary') {
    $date = getParam('date', date('Y-m-d'));
    $stmt = $db->prepare("
        SELECT reference_name,
               COUNT(*) AS farmer_count,
               SUM(total_net_weight) AS total_weight,
               SUM(is_billed) AS billed_count
        FROM yard_entries
        WHERE entry_date = ?
        GROUP BY reference_name
        ORDER BY created_at
    ");
    $stmt->execute([$date]);
    respondList($stmt->fetchAll());
}

// ---- GET: Reference report (date range) ----
if ($method === 'GET' && $action === 'report') {
    $from = getParam('from', date('Y-m-d'));
    $to   = getParam('to',   date('Y-m-d'));
    $ref  = getParam('ref',  '');

    $sql    = "SELECT id, entry_date, reference_name, farmer_id, farmer_name, farmer_name_ta,
                      town, total_net_weight, item_count, is_billed, purchase_bill_id
               FROM yard_entries WHERE entry_date BETWEEN ? AND ?";
    $params = [$from, $to];

    if ($ref === 'DIRECT') {
        $sql .= " AND (reference_name = '' OR reference_name IS NULL)";
    } elseif ($ref) {
        $sql .= " AND reference_name = ?"; $params[] = $ref;
    }
    $sql .= " ORDER BY entry_date DESC, reference_name, farmer_name";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

// ---- POST: Delete yard entry ----
if ($method === 'POST' && $action === 'delete') {
    $b = getBody();
    if (empty($b['id'])) respondError('id required');
    $yd = $db->prepare("SELECT entry_date FROM yard_entries WHERE id = ?");
    $yd->execute([$b['id']]);
    $yrow = $yd->fetch();
    if ($yrow) assertDateUnlocked($yrow['entry_date']);
    $db->prepare("DELETE FROM yard_entries WHERE id = ?")->execute([$b['id']]);
    respond(['id' => $b['id'], 'action' => 'deleted']);
}

// ---- POST: Save vendor allocations for a yard entry's product ----
// Body: { yard_entry_id, product_id, product_name, allocations:[{vendor_id, vendor_name, no_of_bags, weight, bag_weights}] }
// Replaces existing UNBILLED allocations for that (entry, product). Bags not allocated stay as stock.
if ($method === 'POST' && $action === 'allocate') {
    $b = getBody();
    if (empty($b['yard_entry_id'])) respondError('yard_entry_id required');
    if (empty($b['product_id']))    respondError('product_id required');
    $allocations = $b['allocations'] ?? [];

    // Load the yard entry for context + bag-count validation
    $stmt = $db->prepare("SELECT * FROM yard_entries WHERE id = ?");
    $stmt->execute([$b['yard_entry_id']]);
    $entry = $stmt->fetch();
    if (!$entry) respondError('Yard entry not found', 404);
    assertDateUnlocked($entry['entry_date']);

    $items = json_decode($entry['items_json'] ?? '[]', true) ?: [];
    $itemBags = 0;
    foreach ($items as $it) {
        if ((string)($it['product_id'] ?? '') === (string)$b['product_id']) {
            $itemBags = intval($it['bags'] ?? 0);
            break;
        }
    }

    $allocBags = 0;
    foreach ($allocations as $a) { $allocBags += intval($a['no_of_bags'] ?? 0); }

    // Billed allocations for this (entry, product) are NOT replaced — count them toward the cap
    $bStmt = $db->prepare("SELECT COALESCE(SUM(no_of_bags),0) FROM yard_allocations
                           WHERE yard_entry_id = ? AND product_id = ? AND is_billed = 1");
    $bStmt->execute([$b['yard_entry_id'], $b['product_id']]);
    $billedBags = (int)$bStmt->fetchColumn();

    if ($itemBags > 0 && ($allocBags + $billedBags) > $itemBags) {
        respondError("Allocated bags (" . ($allocBags + $billedBags) . ") exceed available bags ($itemBags)");
    }

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // Clear existing unbilled allocations for this (entry, product) — idempotent re-edit
        $db->prepare("DELETE FROM yard_allocations
                      WHERE yard_entry_id = ? AND product_id = ? AND is_billed = 0")
           ->execute([$b['yard_entry_id'], $b['product_id']]);

        $ins = $db->prepare("INSERT INTO yard_allocations
            (yard_entry_id, entry_date, reference_name, farmer_id, farmer_name,
             product_id, product_name, vendor_id, vendor_name,
             no_of_bags, weight, bag_weights_json, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");

        foreach ($allocations as $a) {
            if (empty($a['vendor_id'])) continue; // skip empty/stock rows
            $ins->execute([
                $b['yard_entry_id'],
                $entry['entry_date'],
                $entry['reference_name'],
                $entry['farmer_id'],
                $entry['farmer_name'],
                $b['product_id'],
                $b['product_name'] ?? '',
                $a['vendor_id'],
                $a['vendor_name'] ?? '',
                intval($a['no_of_bags'] ?? 1),
                round((float)($a['weight'] ?? 0), 2),
                isset($a['bag_weights']) ? json_encode($a['bag_weights'], JSON_UNESCAPED_UNICODE) : null,
                $user['id'],
            ]);
        }

        if ($db->inTransaction()) { $db->commit(); }
        respond([
            'yard_entry_id' => $b['yard_entry_id'],
            'product_id'    => $b['product_id'],
            'allocated_bags'=> $allocBags,
            'stock_bags'    => max(0, $itemBags - $allocBags),
            'action'        => 'allocated',
        ]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to save allocations', $e);
    }
}

// ---- GET: List allocations (default: unbilled) ----
// Params: billed (0|1, default 0), date, ref, vendor_id, yard_entry_id
if ($method === 'GET' && $action === 'allocations') {
    $sql    = "SELECT ya.*, p.name_en AS vendor_name_db, p.name_ta AS vendor_name_ta
               FROM yard_allocations ya
               LEFT JOIN parties p ON ya.vendor_id = p.id
               WHERE 1=1";
    $params = [];

    if (getParam('billed', '') !== '') { $sql .= " AND ya.is_billed = ?"; $params[] = (int)getParam('billed'); }
    else                                { $sql .= " AND ya.is_billed = 0"; }

    if ($d = getParam('date'))          { $sql .= " AND ya.entry_date = ?"; $params[] = $d; }
    $ref = getParam('ref', null);
    if ($ref === 'DIRECT')              { $sql .= " AND (ya.reference_name = '' OR ya.reference_name IS NULL)"; }
    elseif ($ref)                       { $sql .= " AND ya.reference_name = ?"; $params[] = $ref; }
    if ($v = getParam('vendor_id'))     { $sql .= " AND ya.vendor_id = ?"; $params[] = $v; }
    if ($ye = getParam('yard_entry_id')){ $sql .= " AND ya.yard_entry_id = ?"; $params[] = $ye; }

    $sql .= " ORDER BY ya.vendor_name, ya.id";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

// ---- GET: Stock = yard items with bags not yet allocated ----
// Params: from, to (default: last 7 days → today)
if ($method === 'GET' && $action === 'stock') {
    $to   = getParam('to',   date('Y-m-d'));
    $from = getParam('from', date('Y-m-d', strtotime('-7 days')));

    $stmt = $db->prepare("SELECT id, entry_date, reference_name, farmer_id, farmer_name, town, items_json
                          FROM yard_entries
                          WHERE entry_date BETWEEN ? AND ?
                          ORDER BY entry_date DESC, id DESC");
    $stmt->execute([$from, $to]);
    $entries = $stmt->fetchAll();

    // Allocated bags per (entry, product)
    $aStmt = $db->prepare("SELECT yard_entry_id, product_id, SUM(no_of_bags) AS allocated
                           FROM yard_allocations
                           GROUP BY yard_entry_id, product_id");
    $aStmt->execute();
    $allocMap = [];
    foreach ($aStmt->fetchAll() as $r) {
        $allocMap[$r['yard_entry_id'] . ':' . $r['product_id']] = (int)$r['allocated'];
    }

    $stock = [];
    foreach ($entries as $e) {
        $items = json_decode($e['items_json'] ?? '[]', true) ?: [];
        foreach ($items as $it) {
            $bags      = intval($it['bags'] ?? 0);
            $allocated = $allocMap[$e['id'] . ':' . ($it['product_id'] ?? '')] ?? 0;
            $remaining = $bags - $allocated;
            if ($remaining > 0) {
                $stock[] = [
                    'yard_entry_id'  => $e['id'],
                    'entry_date'     => $e['entry_date'],
                    'reference_name' => $e['reference_name'],
                    'farmer_id'      => $e['farmer_id'],
                    'farmer_name'    => $e['farmer_name'],
                    'town'           => $e['town'],
                    'product_id'     => $it['product_id'] ?? null,
                    'product_name'   => $it['product_name'] ?? '',
                    'total_bags'     => $bags,
                    'allocated_bags' => $allocated,
                    'stock_bags'     => $remaining,
                    'net_weight'     => $it['net_weight'] ?? 0,
                ];
            }
        }
    }
    respondList($stock);
}

// ---- POST: Mark allocations as billed ----
// Body: { ids:[...], sales_bill_id }
if ($method === 'POST' && $action === 'mark-allocation-billed') {
    $b   = getBody();
    $ids = $b['ids'] ?? [];
    if (empty($ids)) respondError('ids required');
    $ids = array_map('intval', $ids);
    $place = implode(',', array_fill(0, count($ids), '?'));
    $params = array_merge([$b['sales_bill_id'] ?? null], $ids);
    $db->prepare("UPDATE yard_allocations SET is_billed = 1, sales_bill_id = ? WHERE id IN ($place)")
       ->execute($params);
    respond(['ids' => $ids, 'sales_bill_id' => $b['sales_bill_id'] ?? null, 'action' => 'billed']);
}

// ---- POST: Delete an UNBILLED yard allocation (pending sale) ----
if ($method === 'POST' && $action === 'delete-allocation') {
    $id = (int)(getBody()['id'] ?? 0);
    if (!$id) respondError('id required');
    $st = $db->prepare("SELECT entry_date, is_billed FROM yard_allocations WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) respondError('Pending item not found', 404);
    if ((int)$row['is_billed'] === 1) respondError('Already billed — delete the bill instead.', 409);
    assertDateUnlocked($row['entry_date']);
    $db->prepare("DELETE FROM yard_allocations WHERE id=? AND is_billed=0")->execute([$id]);
    auditLog('DELETE', 'yard_allocation', $id, 'Deleted pending yard allocation');
    respond(['action' => 'deleted', 'id' => $id]);
}

respondError('Invalid action', 400);
