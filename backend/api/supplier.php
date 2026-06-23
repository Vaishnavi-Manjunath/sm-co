<?php
// ============================================================
//  IDNUK SOFTWARE - Supplier Purchase API (own-account capital buys)
//  Unlike Farmer Purchase (which DEDUCTS commission/coolie from the
//  farmer's gross), a Supplier Purchase is our OWN stock bought from an
//  out-of-town supplier: charges (freight, market charges, middleman
//  commission) are ADDED on top of the goods value to get the landed cost.
//      total_cost = Σ(qty × rate) + freight + market_charges + middleman_comm + other
//  That cost is what we owe the supplier (a credit on their ledger).
//
//  POST /api/supplier?action=save      - {party_id, bill_date, items[], freight, market_charges, middleman_comm, other_charges, ...}
//  GET  /api/supplier?action=list[&from&to&party_id]
//  GET  /api/supplier?action=get&id=
//  POST /api/supplier?action=update    - {id, ...same as save}
//  POST /api/supplier?action=cancel    - {id}
// ============================================================
require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'list');
$db     = getDB();

migrateOnce('supplier', 2, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS supplier_purchase_bills (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        bill_no         VARCHAR(30) NULL,
        bill_date       DATE NOT NULL,
        bill_time       DATETIME DEFAULT CURRENT_TIMESTAMP,
        party_id        INT UNSIGNED NOT NULL,
        subtotal_weight DECIMAL(12,2) DEFAULT 0,
        subtotal_bags   INT DEFAULT 0,
        goods_amount    DECIMAL(12,2) DEFAULT 0,
        freight         DECIMAL(12,2) DEFAULT 0,
        market_charges  DECIMAL(12,2) DEFAULT 0,
        middleman_comm  DECIMAL(12,2) DEFAULT 0,
        other_charges   DECIMAL(12,2) DEFAULT 0,
        total_cost      DECIMAL(12,2) DEFAULT 0,
        paid_amount     DECIMAL(12,2) DEFAULT 0,
        balance_due     DECIMAL(12,2) DEFAULT 0,
        payment_status  VARCHAR(20) DEFAULT 'unpaid',
        payment_mode    VARCHAR(20) DEFAULT 'cash',
        payment_ref     VARCHAR(60) NULL,
        notes           VARCHAR(255) NULL,
        reference_name  VARCHAR(100) NULL,
        is_cancelled    TINYINT(1) DEFAULT 0,
        created_by      INT UNSIGNED,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NULL,
        INDEX idx_date (bill_date),
        INDEX idx_party (party_id),
        INDEX idx_cancelled (is_cancelled)
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS supplier_purchase_items (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        bill_id     INT UNSIGNED NOT NULL,
        product_id  INT UNSIGNED NOT NULL,
        no_of_bags  INT DEFAULT 0,
        weight      DECIMAL(12,2) DEFAULT 0,
        unit_type   VARCHAR(10) DEFAULT 'KG',
        rate        DECIMAL(12,2) DEFAULT 0,
        amount      DECIMAL(12,2) DEFAULT 0,
        notes       VARCHAR(255) NULL,
        INDEX idx_bill (bill_id)
    )");
    // v2: pending supplier-purchase queue, fed by Orders -> Procurement allocations.
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

// ---- GET: pending supplier-purchase lines (from Orders procurement). Default unbilled. ----
if ($method === 'GET' && $action === 'staged') {
    $sql = "SELECT * FROM supplier_staged_items WHERE 1=1";
    $params = [];
    $billed = getParam('billed');
    $from = getParam('from'); $to = getParam('to');
    if ($from && $to) { $sql .= " AND order_date BETWEEN ? AND ?"; $params[] = $from; $params[] = $to; }
    if ($billed === '0' || $billed === '1') { $sql .= " AND is_billed = ?"; $params[] = (int)$billed; }
    else { $sql .= " AND is_billed = 0"; }
    $sql .= " ORDER BY party_name, id";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

// ---- POST: delete an UNBILLED pending supplier line ----
if ($method === 'POST' && $action === 'delete-staged') {
    $b  = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    $st = $db->prepare("SELECT order_date, is_billed FROM supplier_staged_items WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) respondError('Not found', 404);
    if ((int)$row['is_billed'] === 1) respondError('Already billed — cancel the bill instead.', 409);
    $db->prepare("DELETE FROM supplier_staged_items WHERE id=? AND is_billed=0")->execute([$id]);
    respond(['deleted' => $id]);
}

// Compute bill totals from a payload. Charges are ADDED to the goods value.
function supplierTotals(array $b): array {
    $items = $b['items'] ?? [];
    $subWeight = 0.0; $subBags = 0; $goods = 0.0; $rows = [];
    foreach ($items as $it) {
        if (empty($it['product_id'])) continue;
        $bags = (int)($it['no_of_bags'] ?? 0);
        $wt   = (float)($it['weight'] ?? 0);
        $rate = (float)($it['rate'] ?? 0);
        $unit = strtoupper($it['unit_type'] ?? 'KG');
        $qty  = $unit === 'BAG' ? $bags : $wt;
        $amt  = round($qty * $rate, 2);
        $subWeight += $wt; $subBags += $bags; $goods += $amt;
        $rows[] = ['product_id' => (int)$it['product_id'], 'no_of_bags' => $bags,
                   'weight' => $wt, 'unit_type' => $unit, 'rate' => $rate,
                   'amount' => $amt, 'notes' => $it['notes'] ?? null];
    }
    $freight   = round((float)($b['freight'] ?? 0), 2);
    $market    = round((float)($b['market_charges'] ?? 0), 2);
    $middleman = round((float)($b['middleman_comm'] ?? 0), 2);
    $other     = round((float)($b['other_charges'] ?? 0), 2);
    $total     = round($goods + $freight + $market + $middleman + $other, 2);
    return ['rows' => $rows, 'subtotal_weight' => round($subWeight, 2), 'subtotal_bags' => $subBags,
            'goods_amount' => round($goods, 2), 'freight' => $freight, 'market_charges' => $market,
            'middleman_comm' => $middleman, 'other_charges' => $other, 'total_cost' => $total];
}

// ---- POST: save a new supplier purchase bill ----
if ($method === 'POST' && $action === 'save') {
    $b = getBody();
    if (empty($b['party_id']))      respondError('Supplier required');
    if (empty($b['items']))         respondError('At least one item required');
    $billDate = $b['bill_date'] ?? businessDate();
    assertDateUnlocked($billDate);

    $t = supplierTotals($b);
    if (empty($t['rows'])) respondError('At least one valid item required');
    $paid = round((float)($b['paid_amount'] ?? 0), 2);
    $balance = round($t['total_cost'] - $paid, 2);
    $status  = $paid <= 0 ? 'unpaid' : ($balance <= 0 ? 'paid' : 'partial');

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $billNo = nextBillNo('SUP', $billDate);
        $db->prepare("INSERT INTO supplier_purchase_bills
            (bill_no, bill_date, bill_time, party_id, subtotal_weight, subtotal_bags, goods_amount,
             freight, market_charges, middleman_comm, other_charges, total_cost,
             paid_amount, balance_due, payment_status, payment_mode, payment_ref, notes, reference_name, created_by)
            VALUES (?,?,NOW(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
           ->execute([$billNo, $billDate, $b['party_id'], $t['subtotal_weight'], $t['subtotal_bags'],
                      $t['goods_amount'], $t['freight'], $t['market_charges'], $t['middleman_comm'],
                      $t['other_charges'], $t['total_cost'], $paid, $balance, $status,
                      $b['payment_mode'] ?? 'cash', $b['payment_ref'] ?? null,
                      $b['notes'] ?? null, $b['reference_name'] ?? null, $user['id']]);
        $billId = $db->lastInsertId();

        $iStmt = $db->prepare("INSERT INTO supplier_purchase_items
            (bill_id, product_id, no_of_bags, weight, unit_type, rate, amount, notes)
            VALUES (?,?,?,?,?,?,?,?)");
        foreach ($t['rows'] as $r) {
            $iStmt->execute([$billId, $r['product_id'], $r['no_of_bags'], $r['weight'],
                             $r['unit_type'], $r['rate'], $r['amount'], $r['notes']]);
        }

        // Ledger: we owe the supplier the landed cost (credit increases our payable to them)
        $db->prepare("INSERT INTO ledger (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
                      VALUES (?, 'SUP_PURCHASE', 'supplier_purchase_bills', ?, ?, ?, 0, ?, ?)")
           ->execute([$billDate, $billId, $b['party_id'], "Supplier purchase $billNo", $t['total_cost'], $user['id']]);

        // If this bill was raised from pending (Orders procurement) lines, clear them.
        if (!empty($b['staged_ids']) && is_array($b['staged_ids'])) {
            $ids = array_values(array_filter(array_map('intval', $b['staged_ids'])));
            if ($ids) {
                $place = implode(',', array_fill(0, count($ids), '?'));
                try {
                    $db->prepare("UPDATE supplier_staged_items SET is_billed=1, bill_id=? WHERE id IN ($place)")
                       ->execute(array_merge([$billId], $ids));
                } catch (PDOException $e) { /* staging table absent — ignore */ }
            }
        }

        auditLog('CREATE', 'supplier_purchase', $billId, "Supplier purchase $billNo",
                 ['party_id' => $b['party_id'], 'total_cost' => $t['total_cost']]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['id' => $billId, 'bill_no' => $billNo, 'total_cost' => $t['total_cost'],
                 'balance_due' => $balance, 'action' => 'created']);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to save supplier purchase', $e);
    }
}

// ---- POST: update an existing supplier purchase bill (keeps bill number) ----
if ($method === 'POST' && $action === 'update') {
    $b = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    $ex = $db->prepare("SELECT * FROM supplier_purchase_bills WHERE id=?");
    $ex->execute([$id]);
    $existing = $ex->fetch();
    if (!$existing) respondError('Not found', 404);
    if ((int)$existing['is_cancelled'] === 1) respondError('Bill is cancelled');
    if (empty($b['items'])) respondError('At least one item required');
    $billDate = $b['bill_date'] ?? $existing['bill_date'];
    assertDateUnlocked($billDate);
    assertDateUnlocked($existing['bill_date']);

    $t = supplierTotals($b);
    if (empty($t['rows'])) respondError('At least one valid item required');
    $paid = round((float)($b['paid_amount'] ?? $existing['paid_amount']), 2);
    $balance = round($t['total_cost'] - $paid, 2);
    $status  = $paid <= 0 ? 'unpaid' : ($balance <= 0 ? 'paid' : 'partial');

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $db->prepare("UPDATE supplier_purchase_bills SET bill_date=?, party_id=?, subtotal_weight=?, subtotal_bags=?,
                        goods_amount=?, freight=?, market_charges=?, middleman_comm=?, other_charges=?, total_cost=?,
                        paid_amount=?, balance_due=?, payment_status=?, payment_mode=?, payment_ref=?, notes=?,
                        reference_name=?, updated_at=NOW() WHERE id=?")
           ->execute([$billDate, $b['party_id'], $t['subtotal_weight'], $t['subtotal_bags'], $t['goods_amount'],
                      $t['freight'], $t['market_charges'], $t['middleman_comm'], $t['other_charges'], $t['total_cost'],
                      $paid, $balance, $status, $b['payment_mode'] ?? 'cash', $b['payment_ref'] ?? null,
                      $b['notes'] ?? null, $b['reference_name'] ?? null, $id]);

        $db->prepare("DELETE FROM supplier_purchase_items WHERE bill_id=?")->execute([$id]);
        $iStmt = $db->prepare("INSERT INTO supplier_purchase_items
            (bill_id, product_id, no_of_bags, weight, unit_type, rate, amount, notes)
            VALUES (?,?,?,?,?,?,?,?)");
        foreach ($t['rows'] as $r) {
            $iStmt->execute([$id, $r['product_id'], $r['no_of_bags'], $r['weight'],
                             $r['unit_type'], $r['rate'], $r['amount'], $r['notes']]);
        }

        // Refresh ledger credit to the new landed cost
        $db->prepare("DELETE FROM ledger WHERE ref_type='supplier_purchase_bills' AND ref_id=? AND txn_type='SUP_PURCHASE'")->execute([$id]);
        $db->prepare("INSERT INTO ledger (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
                      VALUES (?, 'SUP_PURCHASE', 'supplier_purchase_bills', ?, ?, ?, 0, ?, ?)")
           ->execute([$billDate, $id, $b['party_id'], "Supplier purchase {$existing['bill_no']}", $t['total_cost'], $user['id']]);

        auditLog('UPDATE', 'supplier_purchase', $id, "Supplier purchase {$existing['bill_no']}",
                 ['total_old' => (float)$existing['total_cost'], 'total_new' => $t['total_cost']]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['id' => $id, 'bill_no' => $existing['bill_no'], 'total_cost' => $t['total_cost'],
                 'balance_due' => $balance, 'action' => 'updated']);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to update supplier purchase', $e);
    }
}

// ---- GET: list supplier purchase bills ----
if ($method === 'GET' && $action === 'list') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    $vid  = getParam('party_id');
    $sql = "SELECT sb.*, p.name_en AS party_name, p.name_ta AS party_name_ta, p.city
            FROM supplier_purchase_bills sb JOIN parties p ON sb.party_id = p.id
            WHERE sb.bill_date BETWEEN ? AND ? AND sb.is_cancelled = 0";
    $params = [$from, $to];
    if ($vid !== null && $vid !== '') { $sql .= " AND sb.party_id = ?"; $params[] = $vid; }
    $sql .= " ORDER BY sb.bill_date DESC, sb.id DESC";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

// ---- GET: a single bill with items ----
if ($method === 'GET' && $action === 'get') {
    $id = (int)getParam('id', 0);
    if (!$id) respondError('id required');
    $bs = $db->prepare("SELECT sb.*, p.name_en AS party_name, p.name_ta AS party_name_ta, p.city, p.phone1
                        FROM supplier_purchase_bills sb JOIN parties p ON sb.party_id = p.id WHERE sb.id=?");
    $bs->execute([$id]);
    $bill = $bs->fetch();
    if (!$bill) respondError('Not found', 404);
    $is = $db->prepare("SELECT si.*, pr.name_en AS product_name, pr.name_ta AS product_name_ta
                        FROM supplier_purchase_items si JOIN products pr ON si.product_id = pr.id
                        WHERE si.bill_id=? ORDER BY si.id");
    $is->execute([$id]);
    $bill['items'] = $is->fetchAll();
    respond($bill);
}

// ---- POST: cancel (void) a supplier purchase bill ----
if ($method === 'POST' && $action === 'cancel') {
    $b = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    $ex = $db->prepare("SELECT * FROM supplier_purchase_bills WHERE id=?");
    $ex->execute([$id]);
    $existing = $ex->fetch();
    if (!$existing) respondError('Not found', 404);
    assertDateUnlocked($existing['bill_date']);
    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $db->prepare("UPDATE supplier_purchase_bills SET is_cancelled=1, updated_at=NOW() WHERE id=?")->execute([$id]);
        $db->prepare("DELETE FROM ledger WHERE ref_type='supplier_purchase_bills' AND ref_id=?")->execute([$id]);
        auditLog('CANCEL', 'supplier_purchase', $id, "Cancelled supplier purchase {$existing['bill_no']}",
                 ['total_cost' => (float)$existing['total_cost']]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['cancelled' => $id]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to cancel', $e);
    }
}

respondError('Invalid action', 400);
