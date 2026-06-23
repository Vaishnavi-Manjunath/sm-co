<?php
// ============================================================
//  IDNUK SOFTWARE - Purchase Bills API
//  GET  /api/purchase              - list bills
//  GET  /api/purchase?action=get&id=
//  POST /api/purchase?action=save  - create bill
//  POST /api/purchase?action=cancel
//  GET  /api/purchase?action=summary - daily summary
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'list');
$db     = getDB();

// One-time migrations (recorded in app_settings; bump the version to add more)
migrateOnce('purchase', 3, function ($db) {
    // v3: unguessable share token for WhatsApp bill links
    try { $db->exec("ALTER TABLE purchase_bills ADD COLUMN share_token VARCHAR(40) NULL DEFAULT NULL"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE purchase_bills ADD UNIQUE INDEX idx_share (share_token)"); } catch (PDOException $e) {}
    // v2: FY bill numbers (PUR-2026-27-00001, 17 chars) — make sure the column fits
    try {
        $null = $db->query("SELECT IS_NULLABLE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='purchase_bills' AND COLUMN_NAME='bill_no'")->fetchColumn();
        if ($null !== false) $db->exec("ALTER TABLE purchase_bills MODIFY bill_no VARCHAR(30) " . ($null === 'NO' ? 'NOT NULL' : 'NULL'));
    } catch (Throwable $e) {}
    // reference_name on bills
    try { $db->exec("ALTER TABLE purchase_bills ADD COLUMN reference_name VARCHAR(100) NULL DEFAULT NULL"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE purchase_bills ADD INDEX idx_ref (reference_name)"); } catch (PDOException $e) {}
    // persist individual bag weights so bills can be edited faithfully
    try { $db->exec("ALTER TABLE purchase_items ADD COLUMN weights_detail VARCHAR(255) NULL DEFAULT NULL"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE purchase_items ADD COLUMN damage_kg DECIMAL(10,2) NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
    // track how many times a bill was printed (anti double-cash for reprints)
    try { $db->exec("ALTER TABLE purchase_bills ADD COLUMN print_count INT NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE purchase_bills ADD COLUMN last_printed_at DATETIME NULL DEFAULT NULL"); } catch (PDOException $e) {}
});

// ---- POST: mark bills as printed (increments print_count) ----
if ($method === 'POST' && $action === 'mark-printed') {
    $b = getBody();
    $ids = array_values(array_filter(array_map('intval', (array)($b['ids'] ?? []))));
    if (!$ids) respondError('ids required');
    $in = implode(',', array_fill(0, count($ids), '?'));
    $db->prepare("UPDATE purchase_bills SET print_count = print_count + 1, last_printed_at = NOW() WHERE id IN ($in)")->execute($ids);
    respond(['marked' => count($ids)]);
}

// ---- POST: share a bill on WhatsApp ----
// Returns a wa.me link to the farmer's number with a Tamil bill summary + a tokenized
// view link (api/billview.php). The token is random and per-bill — only someone who
// has the link (i.e. whoever the operator sends it to) can see that one bill.
if ($method === 'POST' && $action === 'share') {
    $id = (int)(getBody()['id'] ?? 0);
    if (!$id) respondError('id required');
    $st = $db->prepare("SELECT pb.*, p.name_en AS party_name, p.name_ta AS party_name_ta, p.phone1
                        FROM purchase_bills pb JOIN parties p ON pb.party_id = p.id WHERE pb.id = ?");
    $st->execute([$id]);
    $bill = $st->fetch();
    if (!$bill) respondError('Bill not found', 404);

    if (empty($bill['share_token'])) {
        $bill['share_token'] = bin2hex(random_bytes(16));
        $db->prepare("UPDATE purchase_bills SET share_token = ? WHERE id = ?")->execute([$bill['share_token'], $id]);
    }
    $tpl   = companyTpl($db);
    $link  = baseUrl() . '/api/billview.php?t=' . $bill['share_token'];
    $dateD = date('d-m-Y', strtotime($bill['bill_date']));
    $msg = "*{$tpl['company_ta']}*\n"
         . "பில் எண்: {$bill['bill_no']} | தேதி: $dateD\n"
         . "திரு. {$bill['party_name']}" . ($bill['party_name_ta'] ? " / {$bill['party_name_ta']}" : "") . "\n"
         . "மொத்தம்: ₹" . number_format((float)$bill['subtotal_amount'], 2) . "\n"
         . "*நிகர தொகை: ₹" . number_format((float)$bill['net_payable'], 2) . "*\n"
         . "பில் பார்க்க / View bill:\n$link\n"
         . $tpl['greeting'];
    $phone = waPhone($bill['phone1'] ?? '');
    respond([
        'wa_url'  => $phone ? "https://wa.me/$phone?text=" . rawurlencode($msg) : null,
        'message' => $msg, 'link' => $link, 'phone' => $phone,
    ]);
}

// ---- GET: List purchase bills ----
if ($method === 'GET' && $action === 'list') {
    $from    = getParam('from',    date('Y-m-d'));
    $to      = getParam('to',      date('Y-m-d'));
    $partyId = getParam('party_id');

    $refFilter = getParam('ref');
    $productId = getParam('product_id');
    // When filtering by one product, also surface that product's rate/weight/bags per bill
    // (so the counter can eyeball rates across farmers). Subquery param comes first.
    $selExtra = ""; $joinExtra = ""; $params = [];
    if ($productId) {
        $selExtra  = ", fp.f_weight, fp.f_bags, fp.f_amount, fp.f_rates";
        $joinExtra = " LEFT JOIN (SELECT bill_id, SUM(billed_weight) f_weight, SUM(no_of_bags) f_bags,
                           SUM(gross_amount) f_amount, GROUP_CONCAT(DISTINCT purchase_rate ORDER BY purchase_rate) f_rates
                       FROM purchase_items WHERE product_id = ? GROUP BY bill_id) fp ON fp.bill_id = pb.id";
        $params[] = $productId;
    }
    $sql = "SELECT pb.*, p.name_en AS party_name, p.name_ta AS party_name_ta,
                   p.phone1, lp.name_en AS lorry_name, u.username AS created_by_name,
                   (SELECT COALESCE(SUM(no_of_bags),0) FROM purchase_items WHERE bill_id = pb.id) AS total_bags$selExtra
            FROM purchase_bills pb
            JOIN parties p ON pb.party_id = p.id
            LEFT JOIN parties lp ON pb.lorry_party_id = lp.id
            LEFT JOIN users u ON pb.created_by = u.id$joinExtra
            WHERE pb.bill_date BETWEEN ? AND ? AND pb.is_cancelled = 0";
    $params[] = $from; $params[] = $to;

    if ($partyId)   { $sql .= " AND pb.party_id = ?";       $params[] = $partyId; }
    if ($refFilter === 'DIRECT') {
        $sql .= " AND (pb.reference_name = '' OR pb.reference_name IS NULL)";
    } elseif ($refFilter) {
        $sql .= " AND pb.reference_name = ?"; $params[] = $refFilter;
    }
    if ($productId) {
        $sql .= " AND EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.bill_id = pb.id AND pi.product_id = ?)";
        $params[] = $productId;
    }
    $sql .= " ORDER BY pb.bill_date DESC, pb.id DESC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

// ---- GET: Single bill with items ----
if ($method === 'GET' && $action === 'get') {
    $id = getParam('id');
    if (!$id) respondError('id required');

    $stmt = $db->prepare("SELECT pb.*, p.name_en AS party_name, p.name_ta AS party_name_ta,
                                 p.phone1, p.address, p.city
                          FROM purchase_bills pb
                          JOIN parties p ON pb.party_id = p.id
                          WHERE pb.id = ?");
    $stmt->execute([$id]);
    $bill = $stmt->fetch();
    if (!$bill) respondError('Bill not found', 404);

    $stmt = $db->prepare("SELECT pi.*, pr.name_en AS product_name, pr.name_ta AS product_name_ta,
                                 pr.code AS product_code, pr.unit_type
                          FROM purchase_items pi
                          JOIN products pr ON pi.product_id = pr.id
                          WHERE pi.bill_id = ?
                          ORDER BY pi.id");
    $stmt->execute([$id]);
    $bill['items'] = $stmt->fetchAll();

    respond($bill);
}

// ---- POST: Create purchase bill ----
if ($method === 'POST' && $action === 'save') {
    $b     = getBody();
    $items = $b['items'] ?? [];

    if (empty($b['party_id']))  respondError('Farmer/Supplier required');
    if (empty($items))          respondError('At least one item required');

    $billDate = $b['bill_date'] ?? businessDate();
    assertDateUnlocked($billDate);

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $billNo   = nextBillNo('PUR', $billDate);
        $commPct  = (float)($b['commission_pct'] ?? businessRules()['commission_pct']);

        // Calculate totals from items
        $subtotalWeight  = 0;
        $subtotalAmount  = 0;
        $totalCommission = 0;
        $totalSakku      = 0;
        $totalCooly      = 0;
        $totalSungam     = 0;
        $processedItems  = [];

        foreach ($items as $item) {
            $actualWt   = (float)($item['actual_weight']  ?? 0);
            $bagDeduct  = (float)($item['bag_deduction']  ?? 0);
            $damageKg   = (float)($item['damage_kg']      ?? 0);
            $billedWt   = max(0, $actualWt - $bagDeduct - $damageKg);   // damage is deducted from the billed weight
            $rate       = (float)($item['purchase_rate']  ?? 0);
            $qty        = strtoupper($item['unit_type'] ?? 'KG') === 'BAG' ? (float)($item['no_of_bags'] ?? 0) : $billedWt;
            $grossAmt   = round($qty * $rate, 2);
            $itemComm   = round($grossAmt * $commPct / 100, 2);
            $sakkuAmt   = round((float)($item['sakku_qty'] ?? 0) * (float)($item['sakku_rate'] ?? 0), 2);
            $coolyAmt   = (float)($item['cooly_amt']  ?? 0);
            $sungamAmt  = (float)($item['sungam_amt'] ?? 0);
            $netAmt     = round($grossAmt - $itemComm - $sakkuAmt - $coolyAmt - $sungamAmt, 2);

            $subtotalWeight  += $billedWt;
            $subtotalAmount  += $grossAmt;
            $totalCommission += $itemComm;
            $totalSakku      += $sakkuAmt;
            $totalCooly      += $coolyAmt;
            $totalSungam     += $sungamAmt;

            $processedItems[] = [
                'product_id'    => $item['product_id'],
                'actual_weight' => $actualWt,
                'bag_deduction' => $bagDeduct,
                'billed_weight' => $billedWt,
                'no_of_bags'    => $item['no_of_bags']    ?? 1,
                'unit_type'     => $item['unit_type']      ?? 'KG',
                'purchase_rate' => $rate,
                'gross_amount'  => $grossAmt,
                'commission_pct'=> $commPct,
                'commission_amt'=> $itemComm,
                'sakku_qty'     => $item['sakku_qty']     ?? 0,
                'sakku_rate'    => $item['sakku_rate']    ?? 0,
                'sakku_amt'     => $sakkuAmt,
                'cooly_amt'     => $coolyAmt,
                'sungam_amt'    => $sungamAmt,
                'net_amount'    => $netAmt,
                'notes'         => $item['notes']         ?? null,
                'weights_detail'=> $item['weights_detail'] ?? null,
                'damage_kg'     => (float)($item['damage_kg'] ?? 0),
            ];
        }

        $lorryFreight  = (float)($b['lorry_freight']  ?? 0);
        $totalAdvance  = (float)($b['total_advance']  ?? 0);
        $otherDeduct   = (float)($b['other_deductions'] ?? 0);
        // Coolie & cash-advance (sakku) are entered as BILL-LEVEL totals on the form (the items
        // carry 0), so honour the client's totals; and freight must be deducted from the net.
        if (isset($b['total_cooly_amt'])) $totalCooly = (float)$b['total_cooly_amt'];
        if (isset($b['total_sakku_amt'])) $totalSakku = (float)$b['total_sakku_amt'];
        // Commission is rounded to whole rupees at the bill level — no paise on the farmer's bill.
        // Computed on the subtotal (not summed per-item) so it equals the on-screen figure exactly.
        // PHP round() is half-up: .50 and above rounds up, below .50 rounds down (e.g. 1151.23 → 1151).
        $totalCommission = round($subtotalAmount * $commPct / 100);
        $netPayable    = round($subtotalAmount - $totalCommission - $totalSakku
                               - $totalCooly - $totalSungam - $lorryFreight - $totalAdvance - $otherDeduct);

        // Normalise reference: "DIRECT" sentinel → empty string in DB
        $refName = $b['reference'] ?? '';
        if ($refName === 'DIRECT') $refName = '';

        // Insert bill header
        $stmt = $db->prepare("INSERT INTO purchase_bills
            (bill_no, bill_date, bill_time, party_id, party_type, lorry_party_id, lorry_no,
             lorry_freight, commission_pct, subtotal_weight, subtotal_amount,
             total_commission, total_sakku_amt, total_cooly_amt, total_sungam_amt,
             total_advance, other_deductions, net_payable,
             payment_status, payment_mode, payment_ref, notes, reference_name, created_by)
            VALUES (?,?,NOW(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        $stmt->execute([
            $billNo, $billDate, $b['party_id'],
            $b['party_type']    ?? 'FARMER',
            $b['lorry_party_id'] ?? null,
            $b['lorry_no']      ?? null,
            $lorryFreight, $commPct,
            round($subtotalWeight, 2), round($subtotalAmount, 2),
            round($totalCommission, 2), round($totalSakku, 2),
            round($totalCooly, 2), round($totalSungam, 2),
            $totalAdvance, $otherDeduct, $netPayable,
            $b['payment_status'] ?? 'unpaid',
            $b['payment_mode']   ?? 'cash',
            $b['payment_ref']    ?? null,
            $b['notes']          ?? null,
            $refName,
            $user['id']
        ]);
        $billId = $db->lastInsertId();

        // Insert line items
        $iStmt = $db->prepare("INSERT INTO purchase_items
            (bill_id, product_id, actual_weight, bag_deduction, billed_weight, no_of_bags,
             unit_type, purchase_rate, gross_amount, commission_pct, commission_amt,
             sakku_qty, sakku_rate, sakku_amt, cooly_amt, sungam_amt, net_amount, notes, weights_detail, damage_kg)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");

        foreach ($processedItems as $pi) {
            $iStmt->execute([
                $billId, $pi['product_id'], $pi['actual_weight'], $pi['bag_deduction'],
                $pi['billed_weight'], $pi['no_of_bags'], $pi['unit_type'],
                $pi['purchase_rate'], $pi['gross_amount'], $pi['commission_pct'],
                $pi['commission_amt'], $pi['sakku_qty'], $pi['sakku_rate'],
                $pi['sakku_amt'], $pi['cooly_amt'], $pi['sungam_amt'],
                $pi['net_amount'], $pi['notes'], $pi['weights_detail'], $pi['damage_kg']
            ]);
        }

        // Ledger entry - Farmer payment (credit to farmer, debit cash)
        $db->prepare("INSERT INTO ledger
            (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
            VALUES (?, 'PURCHASE', 'purchase_bills', ?, ?, ?, 0, ?, ?)")
           ->execute([$billDate, $billId, $b['party_id'],
                      "Purchase Bill $billNo", $netPayable, $user['id']]);

        // Commission income ledger
        if ($totalCommission > 0) {
            $db->prepare("INSERT INTO ledger
                (txn_date, txn_type, ref_type, ref_id, description, debit, credit, created_by)
                VALUES (?, 'COMMISSION', 'purchase_bills', ?, ?, ?, 0, ?)")
               ->execute([$billDate, $billId, "Commission on $billNo",
                          $totalCommission, $user['id']]);
        }

        auditLog('CREATE', 'purchase_bill', $billId, "Purchase bill $billNo", ['net_payable' => $netPayable, 'party_id' => $b['party_id'], 'commission' => round($totalCommission, 2)]);
        if ($db->inTransaction()) { $db->commit(); }
        respond([
            'id'          => $billId,
            'bill_no'     => $billNo,
            'net_payable' => $netPayable,
            'commission'  => round($totalCommission, 2),
            'action'      => 'created'
        ]);

    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to save bill', $e);
    }
}

// ---- POST: Update an existing purchase bill (keeps the same bill number) ----
if ($method === 'POST' && $action === 'update') {
    $b     = getBody();
    $id    = $b['id'] ?? null;
    $items = $b['items'] ?? [];
    if (!$id)                   respondError('Bill id required');
    if (empty($b['party_id']))  respondError('Farmer/Supplier required');
    if (empty($items))          respondError('At least one item required');

    $cur = $db->prepare("SELECT * FROM purchase_bills WHERE id = ?");
    $cur->execute([$id]);
    $existing = $cur->fetch();
    if (!$existing)                            respondError('Bill not found', 404);
    if ((int)$existing['is_cancelled'] === 1)  respondError('Cannot edit a cancelled bill');

    $billDate = $b['bill_date'] ?? $existing['bill_date'];
    assertDateUnlocked($existing['bill_date'], $billDate);   // block if the old OR new day is locked

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $commPct  = (float)($b['commission_pct'] ?? 10);

        $subtotalWeight = 0; $subtotalAmount = 0; $totalCommission = 0;
        $totalSakku = 0; $totalCooly = 0; $totalSungam = 0; $processedItems = [];

        foreach ($items as $item) {
            $actualWt   = (float)($item['actual_weight'] ?? 0);
            $bagDeduct  = (float)($item['bag_deduction'] ?? 0);
            $damageKg   = (float)($item['damage_kg']     ?? 0);
            $billedWt   = max(0, $actualWt - $bagDeduct - $damageKg);   // damage is deducted from the billed weight
            $rate       = (float)($item['purchase_rate'] ?? 0);
            $qty        = strtoupper($item['unit_type'] ?? 'KG') === 'BAG' ? (float)($item['no_of_bags'] ?? 0) : $billedWt;
            $grossAmt   = round($qty * $rate, 2);
            $itemComm   = round($grossAmt * $commPct / 100, 2);
            $sakkuAmt   = round((float)($item['sakku_qty'] ?? 0) * (float)($item['sakku_rate'] ?? 0), 2);
            $coolyAmt   = (float)($item['cooly_amt'] ?? 0);
            $sungamAmt  = (float)($item['sungam_amt'] ?? 0);
            $netAmt     = round($grossAmt - $itemComm - $sakkuAmt - $coolyAmt - $sungamAmt, 2);

            $subtotalWeight  += $billedWt;   $subtotalAmount  += $grossAmt;
            $totalCommission += $itemComm;   $totalSakku      += $sakkuAmt;
            $totalCooly      += $coolyAmt;   $totalSungam     += $sungamAmt;

            $processedItems[] = [
                'product_id'    => $item['product_id'], 'actual_weight' => $actualWt, 'bag_deduction' => $bagDeduct,
                'billed_weight' => $billedWt, 'no_of_bags' => $item['no_of_bags'] ?? 1, 'unit_type' => $item['unit_type'] ?? 'KG',
                'purchase_rate' => $rate, 'gross_amount' => $grossAmt, 'commission_pct' => $commPct, 'commission_amt' => $itemComm,
                'sakku_qty' => $item['sakku_qty'] ?? 0, 'sakku_rate' => $item['sakku_rate'] ?? 0, 'sakku_amt' => $sakkuAmt,
                'cooly_amt' => $coolyAmt, 'sungam_amt' => $sungamAmt, 'net_amount' => $netAmt, 'notes' => $item['notes'] ?? null,
                'weights_detail' => $item['weights_detail'] ?? null,
                'damage_kg' => (float)($item['damage_kg'] ?? 0),
            ];
        }

        $lorryFreight = (float)($b['lorry_freight'] ?? 0);
        $totalAdvance = (float)($b['total_advance'] ?? 0);
        $otherDeduct  = (float)($b['other_deductions'] ?? 0);
        // Coolie & cash-advance (sakku) are entered as BILL-LEVEL totals on the form (items carry 0);
        // honour the client's totals, and deduct freight from the net.
        if (isset($b['total_cooly_amt'])) $totalCooly = (float)$b['total_cooly_amt'];
        if (isset($b['total_sakku_amt'])) $totalSakku = (float)$b['total_sakku_amt'];
        // Whole-rupee commission & net at the bill level (see save handler) — half-up rounding.
        $totalCommission = round($subtotalAmount * $commPct / 100);
        $netPayable   = round($subtotalAmount - $totalCommission - $totalSakku - $totalCooly - $totalSungam - $lorryFreight - $totalAdvance - $otherDeduct);
        $refName = $b['reference'] ?? '';
        if ($refName === 'DIRECT') $refName = '';

        // Update header — bill_no is intentionally preserved
        $db->prepare("UPDATE purchase_bills SET
                bill_date=?, party_id=?, party_type=?, lorry_party_id=?, lorry_no=?,
                lorry_freight=?, commission_pct=?, subtotal_weight=?, subtotal_amount=?,
                total_commission=?, total_sakku_amt=?, total_cooly_amt=?, total_sungam_amt=?,
                total_advance=?, other_deductions=?, net_payable=?, notes=?, reference_name=?, updated_at=NOW()
            WHERE id=?")
           ->execute([
               $billDate, $b['party_id'], $b['party_type'] ?? 'FARMER',
               $b['lorry_party_id'] ?? null, $b['lorry_no'] ?? null,
               $lorryFreight, $commPct, round($subtotalWeight, 2), round($subtotalAmount, 2),
               round($totalCommission, 2), round($totalSakku, 2), round($totalCooly, 2), round($totalSungam, 2),
               $totalAdvance, $otherDeduct, $netPayable, $b['notes'] ?? null, $refName, $id
           ]);

        // Replace line items
        $db->prepare("DELETE FROM purchase_items WHERE bill_id=?")->execute([$id]);
        $iStmt = $db->prepare("INSERT INTO purchase_items
            (bill_id, product_id, actual_weight, bag_deduction, billed_weight, no_of_bags,
             unit_type, purchase_rate, gross_amount, commission_pct, commission_amt,
             sakku_qty, sakku_rate, sakku_amt, cooly_amt, sungam_amt, net_amount, notes, weights_detail, damage_kg)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        foreach ($processedItems as $pi) {
            $iStmt->execute([
                $id, $pi['product_id'], $pi['actual_weight'], $pi['bag_deduction'],
                $pi['billed_weight'], $pi['no_of_bags'], $pi['unit_type'],
                $pi['purchase_rate'], $pi['gross_amount'], $pi['commission_pct'],
                $pi['commission_amt'], $pi['sakku_qty'], $pi['sakku_rate'],
                $pi['sakku_amt'], $pi['cooly_amt'], $pi['sungam_amt'],
                $pi['net_amount'], $pi['notes'], $pi['weights_detail'], $pi['damage_kg']
            ]);
        }

        // Rebuild ledger entries for this bill
        $db->prepare("DELETE FROM ledger WHERE ref_type='purchase_bills' AND ref_id=?")->execute([$id]);
        $db->prepare("INSERT INTO ledger
            (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
            VALUES (?, 'PURCHASE', 'purchase_bills', ?, ?, ?, 0, ?, ?)")
           ->execute([$billDate, $id, $b['party_id'], "Purchase Bill {$existing['bill_no']}", $netPayable, $user['id']]);
        if ($totalCommission > 0) {
            $db->prepare("INSERT INTO ledger
                (txn_date, txn_type, ref_type, ref_id, description, debit, credit, created_by)
                VALUES (?, 'COMMISSION', 'purchase_bills', ?, ?, ?, 0, ?)")
               ->execute([$billDate, $id, "Commission on {$existing['bill_no']}", round($totalCommission, 2), $user['id']]);
        }

        auditLog('UPDATE', 'purchase_bill', $id, "Purchase bill {$existing['bill_no']}", ['net_old' => (float)$existing['net_payable'], 'net_new' => $netPayable]);
        if ($db->inTransaction()) { $db->commit(); }
        respond([
            'id'          => $id,
            'bill_no'     => $existing['bill_no'],
            'net_payable' => $netPayable,
            'commission'  => round($totalCommission, 2),
            'action'      => 'updated'
        ]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to update bill', $e);
    }
}

// ---- POST: Cancel bill ----
if ($method === 'POST' && $action === 'cancel') {
    $b  = getBody();
    $id = $b['id'] ?? null;
    if (!$id) respondError('Bill id required');

    $cd = $db->prepare("SELECT bill_date FROM purchase_bills WHERE id=?");
    $cd->execute([$id]);
    $cancelRow = $cd->fetch();
    if (!$cancelRow) respondError('Bill not found', 404);
    assertDateUnlocked($cancelRow['bill_date']);

    $db->prepare("UPDATE purchase_bills SET is_cancelled=1, cancel_reason=? WHERE id=?")
       ->execute([$b['reason'] ?? 'Cancelled', $id]);

    // Reverse ledger entries
    $db->prepare("DELETE FROM ledger WHERE ref_type='purchase_bills' AND ref_id=?")
       ->execute([$id]);

    auditLog('VOID', 'purchase_bill', $id, "Cancelled purchase bill", ['reason' => $b['reason'] ?? 'Cancelled']);
    respond(['id' => $id, 'action' => 'cancelled']);
}

// Cash-out journal for farmer/supplier payouts (feeds the Tally day book)
migrateOnce('farmer_payouts', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS farmer_payouts (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        pay_date    DATE NOT NULL,
        party_id    INT UNSIGNED,
        party_name  VARCHAR(150),
        amount      DECIMAL(12,2) DEFAULT 0,
        mode        VARCHAR(20) DEFAULT 'cash',
        bank_name   VARCHAR(80) NULL,
        payment_ref VARCHAR(60) NULL,
        purchase_bill_id INT UNSIGNED NULL,
        created_by  INT UNSIGNED,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (pay_date)
    )");
});

// ---- POST: Record payment to farmer ----
if ($method === 'POST' && $action === 'pay-farmer') {
    $b = getBody();
    if (empty($b['bill_id']) || empty($b['amount'])) respondError('bill_id and amount required');
    $amount = (float)$b['amount'];
    assertDateUnlocked($b['pay_date'] ?? businessDate());

    $stmt = $db->prepare("SELECT pb.id, pb.party_id, pb.net_payable, pb.payment_status, p.name_en AS party_name
                          FROM purchase_bills pb JOIN parties p ON pb.party_id = p.id WHERE pb.id=?");
    $stmt->execute([$b['bill_id']]);
    $bill = $stmt->fetch();
    if (!$bill) respondError('Bill not found', 404);

    $mode = $b['payment_mode'] ?? 'cash';
    $db->prepare("UPDATE purchase_bills SET payment_status='paid', payment_mode=?, payment_ref=?, updated_at=NOW() WHERE id=?")
       ->execute([$mode, $b['payment_ref'] ?? null, $b['bill_id']]);

    // Record the cash-out movement for the day book
    $db->prepare("INSERT INTO farmer_payouts (pay_date, party_id, party_name, amount, mode, bank_name, payment_ref, purchase_bill_id, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?)")
       ->execute([
           $b['pay_date'] ?? businessDate(),
           $bill['party_id'], $bill['party_name'],
           $amount, $mode, $b['bank_name'] ?? null, $b['payment_ref'] ?? null,
           $b['bill_id'], $user['id'],
       ]);

    auditLog('CREATE', 'farmer_payout', $b['bill_id'], "Paid farmer {$bill['party_name']}", ['amount' => $amount, 'mode' => $mode, 'party_id' => $bill['party_id']]);
    respond(['id' => $b['bill_id'], 'action' => 'paid']);
}

// ---- POST: Ad-hoc farmer payout (NO bill) — a plain cash-out so the day book tally
//      reconciles for back-dated payments during the pilot. Does not touch any bill. ----
// body: { party_id?, party_name?, amount, pay_date?, payment_mode?, payment_ref?, bank_name? }
if ($method === 'POST' && $action === 'pay-farmer-adhoc') {
    $b = getBody();
    $amount = (float)($b['amount'] ?? 0);
    if ($amount <= 0) respondError('amount required');
    $payDate = $b['pay_date'] ?? businessDate();
    assertDateUnlocked($payDate);

    // Resolve a display name: prefer explicit name, else look it up from party_id
    $partyId = !empty($b['party_id']) ? (int)$b['party_id'] : null;
    $name    = trim((string)($b['party_name'] ?? ''));
    if ($partyId && $name === '') {
        $ps = $db->prepare("SELECT name_en FROM parties WHERE id=?");
        $ps->execute([$partyId]);
        $name = (string)($ps->fetchColumn() ?: '');
    }
    if ($name === '') respondError('Pick a farmer or enter a name');

    $mode = $b['payment_mode'] ?? 'cash';
    $db->prepare("INSERT INTO farmer_payouts (pay_date, party_id, party_name, amount, mode, bank_name, payment_ref, purchase_bill_id, created_by)
                  VALUES (?,?,?,?,?,?,?,NULL,?)")
       ->execute([$payDate, $partyId, $name, $amount, $mode, $b['bank_name'] ?? null, $b['payment_ref'] ?? null, $user['id']]);

    $pid = $db->lastInsertId();
    auditLog('CREATE', 'farmer_payout', $pid, "Ad-hoc payout to {$name}", ['amount' => $amount, 'mode' => $mode, 'pay_date' => $payDate, 'party_id' => $partyId]);
    respond(['id' => $pid, 'action' => 'paid']);
}

// ---- POST: Delete (void) a farmer payout — marks the bill unpaid again ----
// body: { payout_id }
if ($method === 'POST' && $action === 'delete-payout') {
    $b = getBody();
    $id = (int)($b['payout_id'] ?? 0);
    if (!$id) respondError('payout_id required');

    $ps = $db->prepare("SELECT * FROM farmer_payouts WHERE id=?");
    $ps->execute([$id]);
    $payout = $ps->fetch();
    if (!$payout) respondError('Payout not found', 404);
    assertDateUnlocked($payout['pay_date']);

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        if (!empty($payout['purchase_bill_id'])) {
            $db->prepare("UPDATE purchase_bills SET payment_status='unpaid', payment_ref=NULL, updated_at=NOW() WHERE id=?")
               ->execute([$payout['purchase_bill_id']]);
        }
        $db->prepare("DELETE FROM farmer_payouts WHERE id=?")->execute([$id]);
        auditLog('DELETE', 'farmer_payout', $id, "Voided farmer payout {$payout['party_name']}", ['amount' => (float)$payout['amount']]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['action' => 'deleted', 'amount' => (float)$payout['amount']]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to delete payout', $e);
    }
}

// ============================================================
//  FARMER ADVANCES — money given to a farmer BEFORE goods arrive
//  (crop support). A cash-out that feeds the day book and is tracked
//  separately, mapped to the farmer, until recovered against bills.
// ============================================================
migrateOnce('farmer_advances', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS farmer_advances (
        id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        advance_date DATE NOT NULL,
        party_id     INT UNSIGNED,
        party_name   VARCHAR(150),
        amount       DECIMAL(12,2) DEFAULT 0,
        adjusted_amt DECIMAL(12,2) DEFAULT 0,
        mode         VARCHAR(20) DEFAULT 'cash',
        bank_name    VARCHAR(80) NULL,
        payment_ref  VARCHAR(60) NULL,
        notes        VARCHAR(200) NULL,
        status       VARCHAR(20) DEFAULT 'open',
        created_by   INT UNSIGNED,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (advance_date), INDEX idx_party (party_id)
    )");
});

// ---- POST: Give an advance to a farmer (cash-out, tracked separately) ----
// body: { party_id, party_name?, amount, advance_date?, payment_mode?, payment_ref?, bank_name?, notes? }
if ($method === 'POST' && $action === 'give-advance') {
    $b = getBody();
    $amount = (float)($b['amount'] ?? 0);
    if ($amount <= 0) respondError('amount required');
    $advDate = $b['advance_date'] ?? businessDate();
    assertDateUnlocked($advDate);

    $partyId = !empty($b['party_id']) ? (int)$b['party_id'] : null;
    if (!$partyId) respondError('Pick a farmer');
    $name = trim((string)($b['party_name'] ?? ''));
    if ($name === '') {
        $ps = $db->prepare("SELECT name_en FROM parties WHERE id=?");
        $ps->execute([$partyId]);
        $name = (string)($ps->fetchColumn() ?: '');
    }
    if ($name === '') respondError('Pick a farmer');

    $mode = $b['payment_mode'] ?? 'cash';
    $db->prepare("INSERT INTO farmer_advances (advance_date, party_id, party_name, amount, mode, bank_name, payment_ref, notes, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?)")
       ->execute([$advDate, $partyId, $name, $amount, $mode, $b['bank_name'] ?? null, $b['payment_ref'] ?? null, $b['notes'] ?? null, $user['id']]);

    $id = $db->lastInsertId();
    auditLog('CREATE', 'farmer_advance', $id, "Advance to {$name}", ['amount' => $amount, 'mode' => $mode, 'party_id' => $partyId]);
    respond(['id' => $id, 'action' => 'advanced']);
}

// ---- GET: Farmer advances (report) — line items with outstanding (= amount − adjusted) ----
// params: from?, to?, party_id?, status? (open|settled)
if ($method === 'GET' && $action === 'advances') {
    $from = getParam('from'); $to = getParam('to');
    $partyId = getParam('party_id'); $status = getParam('status');
    $sql = "SELECT fa.*, (fa.amount - fa.adjusted_amt) AS outstanding,
                   p.name_ta AS party_name_ta, p.city
            FROM farmer_advances fa LEFT JOIN parties p ON fa.party_id = p.id WHERE 1=1";
    $params = [];
    if ($from)    { $sql .= " AND fa.advance_date >= ?"; $params[] = $from; }
    if ($to)      { $sql .= " AND fa.advance_date <= ?"; $params[] = $to; }
    if ($partyId) { $sql .= " AND fa.party_id = ?";      $params[] = $partyId; }
    if ($status)  { $sql .= " AND fa.status = ?";        $params[] = $status; }
    $sql .= " ORDER BY fa.advance_date DESC, fa.id DESC";
    $st = $db->prepare($sql); $st->execute($params);
    respondList($st->fetchAll());
}

// ---- POST: Adjust/settle an advance (recovered against goods — bookkeeping only, no cash) ----
// body: { id, amount }  (amount = how much of the advance is now recovered)
if ($method === 'POST' && $action === 'settle-advance') {
    $b   = getBody();
    $id  = (int)($b['id'] ?? 0);
    $adj = (float)($b['amount'] ?? 0);
    if (!$id || $adj <= 0) respondError('id and amount required');

    $st = $db->prepare("SELECT * FROM farmer_advances WHERE id=?");
    $st->execute([$id]);
    $adv = $st->fetch();
    if (!$adv) respondError('Advance not found', 404);

    $newAdj = min((float)$adv['amount'], (float)$adv['adjusted_amt'] + $adj);
    $newStatus = $newAdj >= (float)$adv['amount'] - 0.01 ? 'settled' : 'open';
    $db->prepare("UPDATE farmer_advances SET adjusted_amt=?, status=? WHERE id=?")
       ->execute([$newAdj, $newStatus, $id]);
    auditLog('UPDATE', 'farmer_advance', $id, "Adjusted advance {$adv['party_name']}", ['recovered' => $adj, 'party_id' => $adv['party_id']]);
    respond(['id' => $id, 'adjusted_amt' => $newAdj, 'outstanding' => round((float)$adv['amount'] - $newAdj, 2), 'status' => $newStatus]);
}

// ---- POST: Edit a farmer advance (amount / mode / ref / notes) ----
// body: { id, amount?, payment_mode?, payment_ref?, bank_name?, notes? }
if ($method === 'POST' && $action === 'update-advance') {
    $b  = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    $st = $db->prepare("SELECT * FROM farmer_advances WHERE id=?");
    $st->execute([$id]);
    $adv = $st->fetch();
    if (!$adv) respondError('Advance not found', 404);
    assertDateUnlocked($adv['advance_date']);

    $amount = array_key_exists('amount', $b) ? (float)$b['amount'] : (float)$adv['amount'];
    if ($amount <= 0) respondError('amount must be greater than 0');
    // Keep adjusted within the (possibly reduced) amount and recompute status.
    $adjusted  = min((float)$adv['adjusted_amt'], $amount);
    $newStatus = $adjusted >= $amount - 0.01 && $adjusted > 0 ? 'settled' : 'open';
    $mode = $b['payment_mode'] ?? $adv['mode'];

    $db->prepare("UPDATE farmer_advances SET amount=?, adjusted_amt=?, status=?, mode=?, bank_name=?, payment_ref=?, notes=? WHERE id=?")
       ->execute([
           $amount, $adjusted, $newStatus, $mode,
           $b['bank_name'] ?? $adv['bank_name'],
           array_key_exists('payment_ref', $b) ? $b['payment_ref'] : $adv['payment_ref'],
           array_key_exists('notes', $b) ? $b['notes'] : $adv['notes'],
           $id,
       ]);
    auditLog('UPDATE', 'farmer_advance', $id, "Edited advance {$adv['party_name']}", ['amount_old' => (float)$adv['amount'], 'amount_new' => $amount, 'party_id' => $adv['party_id']]);
    respond(['id' => $id, 'amount' => $amount, 'outstanding' => round($amount - $adjusted, 2), 'status' => $newStatus]);
}

// ---- POST: Delete (void) a farmer advance ----
// body: { id }
if ($method === 'POST' && $action === 'delete-advance') {
    $b  = getBody();
    $id = (int)($b['id'] ?? 0);
    if (!$id) respondError('id required');
    $st = $db->prepare("SELECT * FROM farmer_advances WHERE id=?");
    $st->execute([$id]);
    $adv = $st->fetch();
    if (!$adv) respondError('Advance not found', 404);
    assertDateUnlocked($adv['advance_date']);
    $db->prepare("DELETE FROM farmer_advances WHERE id=?")->execute([$id]);
    auditLog('DELETE', 'farmer_advance', $id, "Deleted advance to {$adv['party_name']}", ['amount' => (float)$adv['amount'], 'party_id' => $adv['party_id']]);
    respond(['id' => $id, 'action' => 'deleted']);
}

// ---- GET: Farmer outstanding (unpaid purchase bills) ----
if ($method === 'GET' && $action === 'farmer-outstanding') {
    $stmt = $db->prepare("
        SELECT pb.id, pb.bill_no, pb.bill_date, pb.net_payable, pb.payment_mode, pb.payment_status,
               pb.reference_name, p.id AS party_id, p.name_en AS farmer_name, p.name_ta AS farmer_name_ta,
               p.phone1, p.city
        FROM purchase_bills pb
        JOIN parties p ON pb.party_id = p.id
        WHERE pb.is_cancelled=0 AND pb.payment_status IN ('unpaid','partial')
        ORDER BY pb.bill_date DESC, p.name_en
    ");
    $stmt->execute();
    respondList($stmt->fetchAll());
}

// ---- GET: Daily purchase summary ----
if ($method === 'GET' && $action === 'summary') {
    $date = getParam('date', date('Y-m-d'));
    $stmt = $db->prepare("
        SELECT
            COUNT(*)                    AS bill_count,
            SUM(subtotal_weight)        AS total_weight,
            SUM(subtotal_amount)        AS gross_amount,
            SUM(total_commission)       AS total_commission,
            SUM(total_sakku_amt)        AS total_sakku,
            SUM(total_cooly_amt)        AS total_cooly,
            SUM(total_sungam_amt)       AS total_sungam,
            SUM(net_payable)            AS total_paid_to_farmers
        FROM purchase_bills
        WHERE bill_date = ? AND is_cancelled = 0
    ");
    $stmt->execute([$date]);
    respond($stmt->fetch());
}

respondError('Invalid action', 400);
