<?php
// ============================================================
//  IDNUK SOFTWARE - Overflow Vendor Collections API
//  GET  ?action=bills          — outstanding overflow bills with items
//  POST ?action=collect        — record a per-bag collection
//  GET  ?action=history        — past overflow collections
//  GET  ?action=report         — P&L summary by vendor
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'bills');
$db     = getDB();

migrateOnce('overflow', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS overflow_collections (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        receipt_no      VARCHAR(30) NOT NULL,
        collection_date DATE NOT NULL,
        bill_id         INT UNSIGNED NOT NULL,
        party_id        INT UNSIGNED NOT NULL,
        notes           TEXT,
        total_billed    DECIMAL(12,2) NOT NULL DEFAULT 0,
        total_collected DECIMAL(12,2) NOT NULL DEFAULT 0,
        variance        DECIMAL(12,2) NOT NULL DEFAULT 0,
        payment_id      INT UNSIGNED NULL,
        created_by      INT UNSIGNED,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bill   (bill_id),
        INDEX idx_party  (party_id),
        INDEX idx_date   (collection_date)
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS overflow_collection_items (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        collection_id   INT UNSIGNED NOT NULL,
        sales_item_id   INT UNSIGNED NULL,
        product_id      INT UNSIGNED NULL,
        product_name    VARCHAR(150),
        bags            INT NOT NULL DEFAULT 0,
        weight          DECIMAL(10,3) NOT NULL DEFAULT 0,
        billed_rate     DECIMAL(10,2) NOT NULL DEFAULT 0,
        billed_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
        actual_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
        variance        DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_coll  (collection_id),
        INDEX idx_item  (sales_item_id)
    )");
});

// ---- GET: Outstanding overflow bills with item breakdown ----
if ($method === 'GET' && $action === 'bills') {
    $partyId = getParam('party_id');

    $sql = "SELECT sb.id, sb.bill_no, sb.bill_date, sb.net_amount, sb.balance_due,
                   sb.paid_amount, sb.payment_status,
                   p.id AS party_id, p.name_en AS party_name, p.name_ta AS party_name_ta, p.phone1
            FROM sales_bills sb
            JOIN parties p ON sb.party_id = p.id
            JOIN party_categories pc ON p.category_id = pc.id
            WHERE sb.is_cancelled = 0
              AND sb.payment_status NOT IN ('paid','cancelled')
              AND sb.balance_due > 0
              AND pc.code = 'OVERFLOW'";
    $params = [];
    if ($partyId) { $sql .= " AND sb.party_id = ?"; $params[] = $partyId; }
    $sql .= " ORDER BY sb.bill_date ASC, sb.id ASC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $bills = $stmt->fetchAll();

    foreach ($bills as &$bill) {
        // Line items with collected-so-far per item
        $items = $db->prepare(
            "SELECT si.id AS item_id, si.product_id,
                    COALESCE(pr.name_en, si.notes) AS product_name, pr.name_ta AS product_name_ta,
                    si.no_of_bags AS total_bags, si.vendor_weight AS weight, si.sale_rate AS rate,
                    si.gross_amount AS billed_amount,
                    COALESCE(SUM(oci.bags), 0)           AS collected_bags,
                    COALESCE(SUM(oci.actual_amount), 0)  AS collected_amount
             FROM sales_items si
             LEFT JOIN products pr ON si.product_id = pr.id
             LEFT JOIN overflow_collection_items oci ON oci.sales_item_id = si.id
             WHERE si.bill_id = ?
             GROUP BY si.id
             ORDER BY si.id"
        );
        $items->execute([$bill['id']]);
        $bill['items'] = $items->fetchAll();

        // Total collected against this bill across all overflow collections
        $col = $db->prepare("SELECT COALESCE(SUM(total_collected),0) AS total_coll,
                                    COALESCE(SUM(total_billed),0)    AS total_bill_settled
                             FROM overflow_collections WHERE bill_id = ?");
        $col->execute([$bill['id']]);
        $summary = $col->fetch();
        $bill['overflow_collected'] = (float)$summary['total_coll'];
        $bill['overflow_billed_settled'] = (float)$summary['total_bill_settled'];
    }
    unset($bill);

    respondList($bills);
}

// ---- POST: Record an overflow collection (per bag) ----
// body: { bill_id, collection_date, notes, items: [{ sales_item_id, bags, weight, billed_rate, billed_amount, actual_amount }] }
if ($method === 'POST' && $action === 'collect') {
    $b     = getBody();
    $billId = (int)($b['bill_id'] ?? 0);
    $items  = $b['items'] ?? [];
    if (!$billId) respondError('bill_id required');
    if (empty($items)) respondError('At least one item with bags > 0 required');

    $date  = $b['collection_date'] ?? businessDate();
    assertDateUnlocked($date);

    // Verify bill belongs to an overflow vendor
    $billRow = $db->prepare("SELECT sb.*, pc.code AS cat_code FROM sales_bills sb
                             JOIN parties p ON sb.party_id = p.id
                             JOIN party_categories pc ON p.category_id = pc.id
                             WHERE sb.id = ?");
    $billRow->execute([$billId]);
    $bill = $billRow->fetch();
    if (!$bill) respondError('Bill not found', 404);
    if ($bill['cat_code'] !== 'OVERFLOW') respondError('Bill is not for an overflow vendor');
    if ((float)$bill['balance_due'] <= 0) respondError('Bill already fully paid');

    $totalBilled    = 0;
    $totalCollected = 0;
    foreach ($items as $item) {
        $bags = (int)($item['bags'] ?? 0);
        if ($bags <= 0) continue;
        $totalBilled    += (float)($item['billed_amount'] ?? 0);
        $totalCollected += (float)($item['actual_amount'] ?? 0);
    }
    if ($totalCollected <= 0) respondError('Total collected amount must be > 0');

    if (!$db->inTransaction()) $db->beginTransaction();
    try {
        $receiptNo = nextBillNo('OVF', $date);

        // payments_received record so it appears in collections history + daybook
        $db->prepare("INSERT INTO payments_received
            (receipt_no, receipt_date, party_id, amount, discount_amt, payment_mode, payment_ref, notes, created_by)
            VALUES (?,?,?,?,0,?,?,?,?)")
           ->execute([
               $receiptNo, $date, $bill['party_id'], $totalCollected,
               $b['payment_mode'] ?? 'cash',
               $b['payment_ref']  ?? null,
               $b['notes'] ? "OVF: {$b['notes']}" : "Overflow collection $receiptNo",
               $user['id']
           ]);
        $paymentId = $db->lastInsertId();

        // payment_allocations to this specific bill
        $allocate = min($totalCollected, (float)$bill['balance_due']);
        $db->prepare("INSERT INTO payment_allocations (payment_id, sales_bill_id, allocated_amt) VALUES (?,?,?)")
           ->execute([$paymentId, $billId, $allocate]);

        // Update bill balance
        $newBalance = max(0, (float)$bill['balance_due'] - $totalCollected);
        $status     = $newBalance <= 0 ? 'paid' : 'partial';
        $db->prepare("UPDATE sales_bills SET balance_due=?, paid_amount=paid_amount+?, payment_status=? WHERE id=?")
           ->execute([$newBalance, $allocate, $status, $billId]);

        // Ledger — cash received
        $db->prepare("INSERT INTO ledger
            (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
            VALUES (?, 'PAYMENT_IN', 'payments_received', ?, ?, ?, 0, ?, ?)")
           ->execute([$date, $paymentId, $bill['party_id'],
                      "Overflow Receipt $receiptNo", $totalCollected, $user['id']]);

        // Variance ledger entry (if actual != billed — profit/loss on overflow)
        $variance = $totalCollected - $totalBilled;
        if (abs($variance) >= 0.01) {
            $varType = $variance > 0 ? 'OVF_GAIN' : 'OVF_LOSS';
            $varDesc = $variance > 0
                ? "Overflow gain on $receiptNo (sold above billed rate)"
                : "Overflow loss on $receiptNo (sold below billed rate)";
            $db->prepare("INSERT INTO ledger
                (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
                VALUES (?, ?, 'overflow_collections', NULL, ?, ?, ?, ?, ?)")
               ->execute([$date, $varType, $bill['party_id'], $varDesc,
                          $variance < 0 ? abs($variance) : 0,
                          $variance > 0 ? $variance : 0,
                          $user['id']]);
        }

        // overflow_collections header
        $db->prepare("INSERT INTO overflow_collections
            (receipt_no, collection_date, bill_id, party_id, notes, total_billed, total_collected, variance, payment_id, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?)")
           ->execute([
               $receiptNo, $date, $billId, $bill['party_id'],
               $b['notes'] ?? null,
               $totalBilled, $totalCollected, $variance,
               $paymentId, $user['id']
           ]);
        $collectionId = $db->lastInsertId();

        // overflow_collection_items
        $iStmt = $db->prepare("INSERT INTO overflow_collection_items
            (collection_id, sales_item_id, product_id, product_name, bags, weight, billed_rate, billed_amount, actual_amount, variance)
            VALUES (?,?,?,?,?,?,?,?,?,?)");
        foreach ($items as $item) {
            $bags = (int)($item['bags'] ?? 0);
            if ($bags <= 0) continue;
            $bAmt = (float)($item['billed_amount'] ?? 0);
            $aAmt = (float)($item['actual_amount'] ?? 0);
            $iStmt->execute([
                $collectionId,
                $item['sales_item_id'] ? (int)$item['sales_item_id'] : null,
                $item['product_id']    ? (int)$item['product_id']    : null,
                $item['product_name']  ?? null,
                $bags,
                (float)($item['weight'] ?? 0),
                (float)($item['billed_rate'] ?? 0),
                $bAmt, $aAmt, $aAmt - $bAmt
            ]);
        }

        auditLog('CREATE', 'overflow_collection', $collectionId, "Overflow Receipt $receiptNo",
            ['bill_id' => $billId, 'party_id' => $bill['party_id'],
             'billed' => $totalBilled, 'collected' => $totalCollected, 'variance' => $variance]);

        if ($db->inTransaction()) $db->commit();
        respond(['id' => $collectionId, 'receipt_no' => $receiptNo,
                 'billed' => $totalBilled, 'collected' => $totalCollected, 'variance' => $variance]);
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        respondServerError('Failed to record overflow collection', $e);
    }
}

// ---- GET: Past overflow collections (history) ----
if ($method === 'GET' && $action === 'history') {
    $from    = getParam('from', date('Y-m-01'));
    $to      = getParam('to',   date('Y-m-d'));
    $partyId = getParam('party_id');

    $sql = "SELECT oc.id, oc.receipt_no, oc.collection_date, oc.bill_id,
                   oc.total_billed, oc.total_collected, oc.variance, oc.notes,
                   sb.bill_no,
                   p.name_en AS party_name, p.name_ta AS party_name_ta
            FROM overflow_collections oc
            JOIN sales_bills sb ON oc.bill_id = sb.id
            JOIN parties p ON oc.party_id = p.id
            WHERE oc.collection_date BETWEEN ? AND ?";
    $params = [$from, $to];
    if ($partyId) { $sql .= " AND oc.party_id = ?"; $params[] = $partyId; }
    $sql .= " ORDER BY oc.collection_date DESC, oc.id DESC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $items = $db->prepare("SELECT product_name, bags, billed_amount, actual_amount, variance FROM overflow_collection_items WHERE collection_id = ?");
        $items->execute([$row['id']]);
        $row['items'] = $items->fetchAll();
    }
    unset($row);

    respondList($rows);
}

// ---- GET: P&L report by vendor ----
if ($method === 'GET' && $action === 'report') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));

    // Per-vendor summary
    $stmt = $db->prepare(
        "SELECT p.id AS party_id, p.name_en AS party_name, p.name_ta AS party_name_ta,
                COUNT(DISTINCT oc.bill_id)  AS bills_with_collections,
                SUM(oc.total_billed)        AS total_billed,
                SUM(oc.total_collected)     AS total_collected,
                SUM(oc.variance)            AS total_variance,
                COUNT(oc.id)                AS collection_events
         FROM overflow_collections oc
         JOIN parties p ON oc.party_id = p.id
         WHERE oc.collection_date BETWEEN ? AND ?
         GROUP BY p.id
         ORDER BY p.name_en"
    );
    $stmt->execute([$from, $to]);
    $vendorRows = $stmt->fetchAll();

    // Outstanding overflow bills (not yet fully settled)
    $stmt2 = $db->prepare(
        "SELECT p.id AS party_id, p.name_en AS party_name,
                COUNT(sb.id)         AS open_bills,
                SUM(sb.net_amount)   AS total_billed_open,
                SUM(sb.balance_due)  AS total_outstanding
         FROM sales_bills sb
         JOIN parties p ON sb.party_id = p.id
         JOIN party_categories pc ON p.category_id = pc.id
         WHERE sb.is_cancelled = 0
           AND sb.payment_status NOT IN ('paid','cancelled')
           AND sb.balance_due > 0
           AND pc.code = 'OVERFLOW'
         GROUP BY p.id
         ORDER BY p.name_en"
    );
    $stmt2->execute([]);
    $openRows = $stmt2->fetchAll();

    respond(['collected' => $vendorRows, 'open' => $openRows]);
}

// ---- POST: Delete an overflow collection — reverses the payment ----
// body: { collection_id }
if ($method === 'POST' && $action === 'delete-collection') {
    $b    = getBody();
    $id   = (int)($b['collection_id'] ?? 0);
    if (!$id) respondError('collection_id required');

    $cs = $db->prepare("SELECT * FROM overflow_collections WHERE id = ?");
    $cs->execute([$id]);
    $c = $cs->fetch();
    if (!$c) respondError('Collection not found', 404);
    assertDateUnlocked($c['collection_date']);

    if (!$db->inTransaction()) $db->beginTransaction();
    try {
        $collected = (float)$c['total_collected'];
        $billId    = (int)$c['bill_id'];

        // Reverse the bill balance
        $bs = $db->prepare("SELECT balance_due, paid_amount FROM sales_bills WHERE id = ?");
        $bs->execute([$billId]);
        $bill = $bs->fetch();
        if ($bill) {
            $newBal  = (float)$bill['balance_due'] + $collected;
            $newPaid = max(0, (float)$bill['paid_amount'] - $collected);
            $status  = $newPaid <= 0 ? 'unpaid' : 'partial';
            $db->prepare("UPDATE sales_bills SET balance_due=?, paid_amount=?, payment_status=? WHERE id=?")
               ->execute([$newBal, $newPaid, $status, $billId]);
        }

        // Remove ledger entries for the payment and variance
        if ($c['payment_id']) {
            $db->prepare("DELETE FROM payment_allocations WHERE payment_id=?")->execute([$c['payment_id']]);
            $db->prepare("DELETE FROM ledger WHERE ref_type='payments_received' AND ref_id=?")->execute([$c['payment_id']]);
            $db->prepare("DELETE FROM payments_received WHERE id=?")->execute([$c['payment_id']]);
        }
        // Variance ledger rows matched by receipt_no in description (ref_id was stored as NULL on creation)
        $db->prepare("DELETE FROM ledger WHERE ref_type='overflow_collections' AND txn_type IN ('OVF_GAIN','OVF_LOSS') AND description LIKE ?")
           ->execute(['%' . $c['receipt_no'] . '%']);

        $db->prepare("DELETE FROM overflow_collection_items WHERE collection_id=?")->execute([$id]);
        $db->prepare("DELETE FROM overflow_collections WHERE id=?")->execute([$id]);

        auditLog('DELETE', 'overflow_collection', $id, "Deleted collection {$c['receipt_no']}",
            ['bill_id' => $billId, 'amount' => $collected, 'party_id' => $c['party_id']]);

        if ($db->inTransaction()) $db->commit();
        respond(['action' => 'deleted', 'receipt_no' => $c['receipt_no'], 'reversed' => $collected]);
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        respondServerError('Failed to delete collection', $e);
    }
}
