<?php
// ============================================================
//  IDNUK SOFTWARE - Market Vendor Settlement API
//  Market vendors both SELL to us (purchases) and BUY from us (sales).
//  Their SALES (what they buy from us) post to the party ledger immediately.
//  Their PURCHASES (what we buy from them) are held PENDING and only post to
//  the ledger — as one consolidated credit note — on Adjust/Settle, where they
//  net against the sales. So the two-way balance reconciles weekly at settle.
//
//  GET  /api/market?action=vendors                 - market vendors + balances
//  POST /api/market?action=set-discount            - {vendor_id, pct}
//  POST /api/market?action=add-purchase            - {vendor_id, purchase_date, amount, note, photo_path}
//  GET  /api/market?action=purchases[&vendor_id&from&to&settled]
//  POST /api/market?action=delete-purchase         - {id}
//  GET  /api/market?action=settlement-preview[&up_to]
//  POST /api/market?action=settle                  - {vendor_id, up_to, discount_pct, net_sales, amount_paid, payment_mode, note}
//  GET  /api/market?action=settlements[&vendor_id&from&to]
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'vendors');
$db     = getDB();

// ---- Schema (one-time; recorded in app_settings) ----
// v2 adds itemisation: each market purchase now carries product line items
// (product / bag / weight / rate) just like Supplier Purchase. The header's
// `amount` still holds the line total so the settlement netting (which reads
// market_purchases.amount) keeps working unchanged. All DDL here is idempotent
// (IF NOT EXISTS / try-catch) so it's safe on both fresh and existing installs.
migrateOnce('market', 4, function ($db) {
    // v4: serial bill number for each market purchase
    try { $db->exec("ALTER TABLE market_purchases ADD COLUMN bill_no VARCHAR(30) NULL DEFAULT NULL"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE market_purchases ADD UNIQUE INDEX idx_mkt_bill_no (bill_no)"); } catch (PDOException $e) {}
});
migrateOnce('market', 3, function ($db) {
$db->exec("CREATE TABLE IF NOT EXISTS market_purchases (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purchase_date DATE NOT NULL,
    vendor_id     INT UNSIGNED NOT NULL,
    amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    note          VARCHAR(255) NULL,
    photo_path    VARCHAR(255) NULL,
    is_settled    TINYINT(1) DEFAULT 0,
    settlement_id INT UNSIGNED NULL,
    created_by    INT UNSIGNED,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_vendor (vendor_id),
    INDEX idx_settled (is_settled),
    INDEX idx_date (purchase_date)
)");
$db->exec("CREATE TABLE IF NOT EXISTS market_purchase_items (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT UNSIGNED NOT NULL,
    product_id  INT UNSIGNED NOT NULL,
    unit_type   VARCHAR(10) DEFAULT 'KG',
    no_of_bags  DECIMAL(10,2) DEFAULT 0,
    weight      DECIMAL(12,2) DEFAULT 0,
    rate        DECIMAL(12,2) DEFAULT 0,
    amount      DECIMAL(12,2) DEFAULT 0,
    INDEX idx_purchase (purchase_id),
    INDEX idx_product (product_id)
)");
try { $db->exec("ALTER TABLE market_purchases ADD COLUMN subtotal_bags DECIMAL(10,2) NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
try { $db->exec("ALTER TABLE market_purchases ADD COLUMN subtotal_weight DECIMAL(12,2) NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
$db->exec("CREATE TABLE IF NOT EXISTS market_settlements (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    settle_date     DATE NOT NULL,
    up_to_date      DATE NOT NULL,
    vendor_id       INT UNSIGNED NOT NULL,
    purchases_total DECIMAL(12,2) DEFAULT 0,
    discount_pct    DECIMAL(5,2) DEFAULT 0,
    discount_amt    DECIMAL(12,2) DEFAULT 0,
    sales_netted    DECIMAL(12,2) DEFAULT 0,
    amount_paid     DECIMAL(12,2) DEFAULT 0,
    carry_balance   DECIMAL(12,2) DEFAULT 0,
    payment_mode    VARCHAR(20) DEFAULT 'cash',
    note            VARCHAR(255) NULL,
    created_by      INT UNSIGNED,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_vendor (vendor_id),
    INDEX idx_date (settle_date)
)");
try { $db->exec("ALTER TABLE parties ADD COLUMN market_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
// v3: store the per-bill netting allocation as JSON so a settlement can be reversed exactly.
try { $db->exec("ALTER TABLE market_settlements ADD COLUMN netted_bills TEXT NULL"); } catch (PDOException $e) {}
});

// Market vendor categories (they can be tagged as any of these)
$MARKET_CATS = "'MARKET_VENDOR','CUSTOMER','OVERFLOW','MARKET_SUPPLIER'";

// Helper: a vendor's unpaid sales dues (what THEY owe US)
function salesDue(PDO $db, int $vid): float {
    $s = $db->prepare("SELECT COALESCE(SUM(balance_due),0) v FROM sales_bills WHERE party_id=? AND is_cancelled=0");
    $s->execute([$vid]);
    return (float)$s->fetch()['v'];
}
// Helper: unsettled market purchases total up to a date (what WE owe THEM)
function purchasesOwed(PDO $db, int $vid, string $upTo): float {
    $s = $db->prepare("SELECT COALESCE(SUM(amount),0) v FROM market_purchases WHERE vendor_id=? AND is_settled=0 AND purchase_date<=?");
    $s->execute([$vid, $upTo]);
    return (float)$s->fetch()['v'];
}

// ---- GET: market vendors with balances ----
if ($method === 'GET' && $action === 'vendors') {
    $stmt = $db->query("SELECT p.id, p.name_en, p.name_ta, p.phone1, p.city,
                               COALESCE(p.market_discount_pct,0) AS market_discount_pct
                        FROM parties p JOIN party_categories pc ON p.category_id = pc.id
                        WHERE pc.code IN ($MARKET_CATS) AND p.is_active = 1
                        ORDER BY p.name_en");
    $today = date('Y-m-d');
    $out = [];
    foreach ($stmt->fetchAll() as $v) {
        $vid = (int)$v['id'];
        $owed = purchasesOwed($db, $vid, $today);
        $due  = salesDue($db, $vid);
        $v['purchases_owed'] = round($owed, 2);
        $v['sales_due']      = round($due, 2);
        $v['net_owed']       = round($owed - $due, 2);   // +ve = we owe them, -ve = they owe us
        $out[] = $v;                                      // all active market vendors (needed for the entry dropdown)
    }
    respondList($out);
}

// ---- POST: set a vendor's default market discount % ----
if ($method === 'POST' && $action === 'set-discount') {
    $b = getBody();
    $vid = (int)($b['vendor_id'] ?? 0);
    $pct = (float)($b['pct'] ?? 0);
    if (!$vid) respondError('vendor_id required');
    $db->prepare("UPDATE parties SET market_discount_pct=? WHERE id=?")->execute([$pct, $vid]);
    auditLog('UPDATE', 'vendor_discount', $vid, "Set market discount %", ['pct' => $pct]);
    respond(['vendor_id' => $vid, 'market_discount_pct' => $pct]);
}

// ---- POST: record a purchase made from a market vendor ----
if ($method === 'POST' && $action === 'add-purchase') {
    $b = getBody();
    $vid    = (int)($b['vendor_id'] ?? 0);
    $date   = $b['purchase_date'] ?? businessDate();
    if (!$vid) respondError('Vendor required');
    assertDateUnlocked($date);

    // Itemise the buy (product / bag / weight / rate). Local market buys carry NO
    // extra charges, so the header `amount` is simply the sum of the line amounts
    // (qty × rate) — keeping it populated means the weekly settlement netting,
    // which reads market_purchases.amount, works unchanged.
    $items   = is_array($b['items'] ?? null) ? $b['items'] : [];
    $clean   = [];
    $amount  = 0.0; $subBags = 0.0; $subWeight = 0.0;
    foreach ($items as $it) {
        $pid2 = (int)($it['product_id'] ?? 0);
        if (!$pid2) continue;
        $unit = strtoupper($it['unit_type'] ?? 'KG');
        $bags = round((float)($it['no_of_bags'] ?? 0), 2);
        $wt   = round((float)($it['weight'] ?? 0), 2);
        $rate = round((float)($it['rate'] ?? 0), 2);
        $qty  = $unit === 'BAG' ? $bags : $wt;
        if ($qty <= 0 || $rate <= 0) continue;
        $amt  = round($qty * $rate, 2);
        $clean[] = ['product_id' => $pid2, 'unit_type' => $unit, 'no_of_bags' => $bags, 'weight' => $wt, 'rate' => $rate, 'amount' => $amt];
        $amount += $amt; $subBags += $bags; $subWeight += $wt;
    }
    if ($clean) {
        $amount = round($amount, 2);
    } else {
        // Backward-compatible fallback: a plain amount with no line items.
        $amount = round((float)($b['amount'] ?? 0), 2);
        if ($amount <= 0) respondError('Add at least one product with quantity and rate');
    }

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $billNo = nextBillNo('MKT', $date);
        $db->prepare("INSERT INTO market_purchases (bill_no, purchase_date, vendor_id, amount, subtotal_bags, subtotal_weight, note, photo_path, created_by)
                      VALUES (?,?,?,?,?,?,?,?,?)")
           ->execute([$billNo, $date, $vid, $amount, $subBags, $subWeight, $b['note'] ?? null, $b['photo_path'] ?? null, $user['id']]);
        $pid = $db->lastInsertId();
        if ($clean) {
            $ins = $db->prepare("INSERT INTO market_purchase_items (purchase_id, product_id, unit_type, no_of_bags, weight, rate, amount)
                                 VALUES (?,?,?,?,?,?,?)");
            foreach ($clean as $c) {
                $ins->execute([$pid, $c['product_id'], $c['unit_type'], $c['no_of_bags'], $c['weight'], $c['rate'], $c['amount']]);
            }
        }
        // NOTE: market purchases are held PENDING and do NOT post to the party ledger here.
        // They enter the ledger as a single consolidated credit note only on Adjust/Settle
        // (see the 'settle' action), so daily entries don't clutter the vendor's ledger.
        // The Market screen's running balances read straight from market_purchases, so the
        // pending amount is still visible there immediately.
        auditLog('CREATE', 'market_purchase', $pid, "Market purchase", ['vendor_id' => $vid, 'amount' => $amount, 'date' => $date, 'note' => $b['note'] ?? null]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['id' => $pid, 'bill_no' => $billNo, 'amount' => $amount]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to save', $e);
    }
}

// ---- POST: edit an unsettled purchase (replace header + line items) ----
if ($method === 'POST' && $action === 'update-purchase') {
    $b   = getBody();
    $id  = (int)($b['id'] ?? 0);
    $vid = (int)($b['vendor_id'] ?? 0);
    if (!$id)  respondError('id required');
    if (!$vid) respondError('Vendor required');

    $row = $db->prepare("SELECT * FROM market_purchases WHERE id=?");
    $row->execute([$id]);
    $mp = $row->fetch();
    if (!$mp) respondError('Not found', 404);
    if ((int)$mp['is_settled'] === 1) respondError('Already settled — reverse the settlement first');

    $date = $b['purchase_date'] ?? $mp['purchase_date'];
    assertDateUnlocked($mp['purchase_date']);   // can't edit a purchase sitting on a frozen day
    if ($date !== $mp['purchase_date']) assertDateUnlocked($date);   // nor move it onto one

    // Re-itemise exactly like add-purchase so the header amount stays = Σ(qty × rate).
    $items   = is_array($b['items'] ?? null) ? $b['items'] : [];
    $clean   = [];
    $amount  = 0.0; $subBags = 0.0; $subWeight = 0.0;
    foreach ($items as $it) {
        $pid2 = (int)($it['product_id'] ?? 0);
        if (!$pid2) continue;
        $unit = strtoupper($it['unit_type'] ?? 'KG');
        $bags = round((float)($it['no_of_bags'] ?? 0), 2);
        $wt   = round((float)($it['weight'] ?? 0), 2);
        $rate = round((float)($it['rate'] ?? 0), 2);
        $qty  = $unit === 'BAG' ? $bags : $wt;
        if ($qty <= 0 || $rate <= 0) continue;
        $amt  = round($qty * $rate, 2);
        $clean[] = ['product_id' => $pid2, 'unit_type' => $unit, 'no_of_bags' => $bags, 'weight' => $wt, 'rate' => $rate, 'amount' => $amt];
        $amount += $amt; $subBags += $bags; $subWeight += $wt;
    }
    if ($clean) {
        $amount = round($amount, 2);
    } else {
        $amount = round((float)($b['amount'] ?? 0), 2);
        if ($amount <= 0) respondError('Add at least one product with quantity and rate');
    }

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $db->prepare("UPDATE market_purchases SET purchase_date=?, vendor_id=?, amount=?, subtotal_bags=?, subtotal_weight=?, note=? WHERE id=?")
           ->execute([$date, $vid, $amount, $subBags, $subWeight, $b['note'] ?? null, $id]);
        try { $db->prepare("DELETE FROM market_purchase_items WHERE purchase_id=?")->execute([$id]); } catch (PDOException $e) {}
        if ($clean) {
            $ins = $db->prepare("INSERT INTO market_purchase_items (purchase_id, product_id, unit_type, no_of_bags, weight, rate, amount)
                                 VALUES (?,?,?,?,?,?,?)");
            foreach ($clean as $c) {
                $ins->execute([$id, $c['product_id'], $c['unit_type'], $c['no_of_bags'], $c['weight'], $c['rate'], $c['amount']]);
            }
        }
        auditLog('UPDATE', 'market_purchase', $id, "Edited market purchase", ['vendor_id' => $vid, 'amount' => $amount, 'date' => $date, 'note' => $b['note'] ?? null]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['id' => $id, 'amount' => $amount]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to update', $e);
    }
}

// ---- GET: list market purchases ----
if ($method === 'GET' && $action === 'purchases') {
    $from   = getParam('from', date('Y-m-01'));
    $to     = getParam('to',   date('Y-m-d'));
    $vid    = getParam('vendor_id');
    $settled= getParam('settled');   // '0' | '1' | null(all)
    $sql = "SELECT mp.*, p.name_en AS vendor_name, p.name_ta AS vendor_name_ta
            FROM market_purchases mp JOIN parties p ON mp.vendor_id = p.id
            WHERE mp.purchase_date BETWEEN ? AND ?";
    $params = [$from, $to];
    if ($vid !== null && $vid !== '')         { $sql .= " AND mp.vendor_id = ?";  $params[] = $vid; }
    if ($settled === '0' || $settled === '1') { $sql .= " AND mp.is_settled = ?"; $params[] = (int)$settled; }
    $sql .= " ORDER BY mp.purchase_date DESC, mp.id DESC";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $list = $stmt->fetchAll();
    // Attach line items so the screen can show the product breakdown.
    $ids = array_column($list, 'id');
    if ($ids) {
        $in = implode(',', array_fill(0, count($ids), '?'));
        try {
            $iq = $db->prepare("SELECT mpi.*, pr.name_en AS product_name, pr.name_ta AS product_name_ta
                                FROM market_purchase_items mpi JOIN products pr ON mpi.product_id = pr.id
                                WHERE mpi.purchase_id IN ($in) ORDER BY mpi.id");
            $iq->execute($ids);
            $byP = [];
            foreach ($iq->fetchAll() as $it) { $byP[$it['purchase_id']][] = $it; }
            foreach ($list as &$row) { $row['items'] = $byP[$row['id']] ?? []; }
            unset($row);
        } catch (PDOException $e) { /* items table not present yet */ }
    }
    respondList($list);
}

// ---- POST: delete (void) an unsettled purchase ----
if ($method === 'POST' && $action === 'delete-purchase') {
    $b = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    $row = $db->prepare("SELECT * FROM market_purchases WHERE id=?");
    $row->execute([$id]);
    $mp = $row->fetch();
    if (!$mp) respondError('Not found', 404);
    if ((int)$mp['is_settled'] === 1) respondError('Already settled — reverse the settlement first');
    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $db->prepare("DELETE FROM ledger WHERE ref_type='market_purchases' AND ref_id=?")->execute([$id]);
        try { $db->prepare("DELETE FROM market_purchase_items WHERE purchase_id=?")->execute([$id]); } catch (PDOException $e) {}
        $db->prepare("DELETE FROM market_purchases WHERE id=?")->execute([$id]);
        auditLog('DELETE', 'market_purchase', $id, "Deleted market purchase", ['vendor_id' => $mp['vendor_id'], 'amount' => (float)$mp['amount']]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['deleted' => $id]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed', $e);
    }
}

// ---- GET: settlement preview (per vendor, unsettled up to a date) ----
if ($method === 'GET' && $action === 'settlement-preview') {
    $upTo = getParam('up_to', date('Y-m-d'));
    $stmt = $db->query("SELECT p.id, p.name_en, p.name_ta, p.phone1,
                               COALESCE(p.market_discount_pct,0) AS market_discount_pct
                        FROM parties p JOIN party_categories pc ON p.category_id = pc.id
                        WHERE pc.code IN ($MARKET_CATS) AND p.is_active = 1
                        ORDER BY p.name_en");
    $out = [];
    foreach ($stmt->fetchAll() as $v) {
        $vid  = (int)$v['id'];
        $P    = purchasesOwed($db, $vid, $upTo);
        if ($P <= 0) continue;                         // nothing to settle
        $pct  = (float)$v['market_discount_pct'];
        $D    = round($P * $pct / 100, 2);
        $due  = salesDue($db, $vid);
        $S    = round(min($due, max(0, $P - $D)), 2);   // suggested netting
        $v['purchases_total'] = round($P, 2);
        $v['discount_pct']    = $pct;
        $v['discount_amt']    = $D;
        $v['sales_due']       = round($due, 2);
        $v['net_sales']       = $S;
        $v['net_owed']        = round($P - $D - $S, 2);
        $out[] = $v;
    }
    respondList($out);
}

// ---- POST: settle a vendor for the week ----
if ($method === 'POST' && $action === 'settle') {
    $b = getBody();
    $vid  = (int)($b['vendor_id'] ?? 0);
    $upTo = $b['up_to'] ?? date('Y-m-d');
    if (!$vid) respondError('Vendor required');
    assertDateUnlocked($b['settle_date'] ?? businessDate());

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // Lock the purchases being settled
        $ps = $db->prepare("SELECT id, amount FROM market_purchases WHERE vendor_id=? AND is_settled=0 AND purchase_date<=?");
        $ps->execute([$vid, $upTo]);
        $rows = $ps->fetchAll();
        $P = 0.0; $ids = [];
        foreach ($rows as $r) { $P += (float)$r['amount']; $ids[] = (int)$r['id']; }
        $P = round($P, 2);
        if ($P <= 0) respondError('No unsettled purchases for this vendor');

        $pct = isset($b['discount_pct']) ? (float)$b['discount_pct'] : 0;
        $D   = isset($b['discount_amt']) ? round((float)$b['discount_amt'], 2) : round($P * $pct / 100, 2);
        $due = salesDue($db, $vid);
        $S   = round(min((float)($b['net_sales'] ?? min($due, max(0, $P - $D))), $due, max(0, $P - $D)), 2);
        $C   = round((float)($b['amount_paid'] ?? 0), 2);
        $carry = round($P - $D - $S - $C, 2);
        $date  = $b['settle_date'] ?? businessDate();
        $mode  = $b['payment_mode'] ?? 'cash';

        // 1) settlement header
        $db->prepare("INSERT INTO market_settlements
            (settle_date, up_to_date, vendor_id, purchases_total, discount_pct, discount_amt,
             sales_netted, amount_paid, carry_balance, payment_mode, note, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
           ->execute([$date, $upTo, $vid, $P, $pct, $D, $S, $C, $carry, $mode, $b['note'] ?? null, $user['id']]);
        $sid = $db->lastInsertId();

        // 1b) post the week's purchases into the ledger NOW (deferred from entry time) as a
        //     single consolidated credit note — this is the moment market purchases hit the
        //     party ledger / Tally. The discount/netting/payout steps below then offset it,
        //     leaving the carry balance as the standing "we still owe them" credit.
        //     Migration-safe: purchases entered BEFORE this change already posted a per-row
        //     MKT_PURCHASE credit at entry time, so only post the not-yet-ledgered remainder
        //     (avoids double-counting any pre-deploy purchases that settle after the change).
        $alreadyPosted = 0.0;
        if ($ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            $lq = $db->prepare("SELECT COALESCE(SUM(credit),0) FROM ledger
                                WHERE txn_type='MKT_PURCHASE' AND ref_type='market_purchases' AND ref_id IN ($in)");
            $lq->execute($ids);
            $alreadyPosted = round((float)$lq->fetchColumn(), 2);
        }
        $toPost = round($P - $alreadyPosted, 2);
        if ($toPost > 0) {
            $db->prepare("INSERT INTO ledger (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
                          VALUES (?, 'MKT_PURCHASE', 'market_settlements', ?, ?, ?, 0, ?, ?)")
               ->execute([$date, $sid, $vid, "Market purchases settled (up to {$upTo})", $toPost, $user['id']]);
        }

        // 2) mark purchases settled
        if ($ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            $db->prepare("UPDATE market_purchases SET is_settled=1, settlement_id=? WHERE id IN ($in)")
               ->execute(array_merge([$sid], $ids));
        }

        // 3) discount they gave us -> reduces our payable (debit)
        if ($D > 0) {
            $db->prepare("INSERT INTO ledger (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
                          VALUES (?, 'MKT_DISCOUNT', 'market_settlements', ?, ?, ?, ?, 0, ?)")
               ->execute([$date, $sid, $vid, "Market discount {$pct}%", $D, $user['id']]);
        }

        // 4) net their sales dues against what we owe them: clear their open sales bills.
        //    We DON'T post the old two-line MKT_NET pair here — those (a "Sales netted"
        //    credit + a "Purchase offset" debit of the same amount) net to ZERO on the
        //    party balance and were purely cosmetic, so the single consolidated
        //    MKT_PURCHASE credit above already reflects the correct standing balance.
        //    We record which bills were cleared (and by how much) so a settlement can be
        //    reversed exactly (see 'delete-settlement').
        $nettedBills = [];
        if ($S > 0) {
            $remaining = $S;
            $bills = $db->prepare("SELECT id, balance_due, paid_amount FROM sales_bills
                                   WHERE party_id=? AND is_cancelled=0 AND balance_due>0
                                   ORDER BY bill_date ASC, id ASC");
            $bills->execute([$vid]);
            foreach ($bills->fetchAll() as $bill) {
                if ($remaining <= 0) break;
                $apply   = min($remaining, (float)$bill['balance_due']);
                $remaining -= $apply;
                $newBal  = round((float)$bill['balance_due'] - $apply, 2);
                $newPaid = round((float)$bill['paid_amount'] + $apply, 2);
                $status  = $newBal <= 0 ? 'paid' : 'partial';
                $db->prepare("UPDATE sales_bills SET balance_due=?, paid_amount=?, payment_status=? WHERE id=?")
                   ->execute([$newBal, $newPaid, $status, $bill['id']]);
                $nettedBills[] = ['bill_id' => (int)$bill['id'], 'amount' => round($apply, 2)];
            }
            $S = round($S - $remaining, 2);
        }

        // 5) cash paid to vendor -> reduces our payable (debit)
        if ($C > 0) {
            $db->prepare("INSERT INTO ledger (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
                          VALUES (?, 'MKT_PAYOUT', 'market_settlements', ?, ?, ?, ?, 0, ?)")
               ->execute([$date, $sid, $vid, "Market payout ({$mode})", $C, $user['id']]);
        }

        // refresh stored numbers in case S was clamped by actual bills; persist the
        // per-bill netting allocation so the settlement can be reversed exactly.
        $carry = round($P - $D - $S - $C, 2);
        try {
            $db->prepare("UPDATE market_settlements SET sales_netted=?, carry_balance=?, netted_bills=? WHERE id=?")
               ->execute([$S, $carry, json_encode($nettedBills), $sid]);
        } catch (PDOException $e) {
            $db->prepare("UPDATE market_settlements SET sales_netted=?, carry_balance=? WHERE id=?")
               ->execute([$S, $carry, $sid]);
        }

        auditLog('CREATE', 'market_settlement', $sid, "Market settlement", ['vendor_id' => $vid, 'purchases' => $P, 'discount' => $D, 'netted' => $S, 'paid' => $C, 'carry' => $carry]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['id' => $sid, 'purchases' => $P, 'discount' => $D, 'netted' => $S, 'paid' => $C, 'carry' => $carry]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to settle', $e);
    }
}

// ---- POST: reverse (delete) a settlement ----
// Undoes everything the settle did: restores the netted sales bills, re-opens the
// settled purchases (so they show pending again), and removes the ledger entries.
if ($method === 'POST' && $action === 'delete-settlement') {
    $b = getBody();
    $sid = (int)($b['id'] ?? 0);
    if (!$sid) respondError('id required');
    $row = $db->prepare("SELECT * FROM market_settlements WHERE id=?");
    $row->execute([$sid]);
    $ms = $row->fetch();
    if (!$ms) respondError('Not found', 404);
    assertDateUnlocked($ms['settle_date']);

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // 1) restore the sales bills that were netted (add the cleared amount back)
        $netted = json_decode($ms['netted_bills'] ?? '[]', true);
        if (is_array($netted)) {
            foreach ($netted as $nb) {
                $bid = (int)($nb['bill_id'] ?? 0);
                $amt = round((float)($nb['amount'] ?? 0), 2);
                if (!$bid || $amt <= 0) continue;
                $bp = $db->prepare("SELECT balance_due, paid_amount FROM sales_bills WHERE id=?");
                $bp->execute([$bid]);
                $bill = $bp->fetch();
                if (!$bill) continue;
                $newBal  = round((float)$bill['balance_due'] + $amt, 2);
                $newPaid = max(0, round((float)$bill['paid_amount'] - $amt, 2));
                $status  = $newBal <= 0 ? 'paid' : ($newPaid > 0 ? 'partial' : 'unpaid');
                $db->prepare("UPDATE sales_bills SET balance_due=?, paid_amount=?, payment_status=? WHERE id=?")
                   ->execute([$newBal, $newPaid, $status, $bid]);
            }
        }
        // 2) re-open the settled purchases
        $db->prepare("UPDATE market_purchases SET is_settled=0, settlement_id=NULL WHERE settlement_id=?")->execute([$sid]);
        // 3) remove the settlement's ledger entries
        $db->prepare("DELETE FROM ledger WHERE ref_type='market_settlements' AND ref_id=?")->execute([$sid]);
        // 4) delete the settlement header
        $db->prepare("DELETE FROM market_settlements WHERE id=?")->execute([$sid]);
        auditLog('DELETE', 'market_settlement', $sid, "Reversed market settlement",
            ['vendor_id' => (int)$ms['vendor_id'], 'purchases' => (float)$ms['purchases_total'],
             'netted' => (float)$ms['sales_netted'], 'paid' => (float)$ms['amount_paid']]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['deleted' => $sid]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to reverse settlement', $e);
    }
}

// ---- GET: settlement history ----
if ($method === 'GET' && $action === 'settlements') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    $vid  = getParam('vendor_id');
    $sql = "SELECT ms.*, p.name_en AS vendor_name, p.name_ta AS vendor_name_ta
            FROM market_settlements ms JOIN parties p ON ms.vendor_id = p.id
            WHERE ms.settle_date BETWEEN ? AND ?";
    $params = [$from, $to];
    if ($vid !== null && $vid !== '') { $sql .= " AND ms.vendor_id = ?"; $params[] = $vid; }
    $sql .= " ORDER BY ms.settle_date DESC, ms.id DESC";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

respondError('Invalid action', 400);
