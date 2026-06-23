<?php
// ============================================================
//  IDNUK SOFTWARE - Sales Bills API
//  GET  /api/sales                 - list bills
//  GET  /api/sales?action=get&id=
//  POST /api/sales?action=save
//  POST /api/sales?action=payment  - record payment received
//  GET  /api/sales?action=summary
//  GET  /api/sales?action=aging    - payment aging report
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'list');
$db     = getDB();

// One-time migrations (recorded in app_settings; bump the version to add more)
migrateOnce('sales', 6, function ($db) {
    // v6: store the vendor's outstanding before this bill so reprints show correct previous balance
    try { $db->exec("ALTER TABLE sales_bills ADD COLUMN opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
    // v5: amount the vendor paid at billing time (shown as "credited" on the printed bill)
    try { $db->exec("ALTER TABLE sales_bills ADD COLUMN credited_amt DECIMAL(12,2) NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
    // v4: store the discount taken on a receipt so it shows in the collections list
    try { $db->exec("ALTER TABLE payments_received ADD COLUMN discount_amt DECIMAL(12,2) NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
    // v3: unguessable share token for WhatsApp bill links
    try { $db->exec("ALTER TABLE sales_bills ADD COLUMN share_token VARCHAR(40) NULL DEFAULT NULL"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE sales_bills ADD UNIQUE INDEX idx_share (share_token)"); } catch (PDOException $e) {}
    // v2: FY bill/receipt numbers (SAL-2026-27-00001, 17 chars) — make sure the columns fit
    foreach ([['sales_bills', 'bill_no'], ['payments_received', 'receipt_no']] as [$t, $c]) {
        try {
            $null = $db->query("SELECT IS_NULLABLE FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='$t' AND COLUMN_NAME='$c'")->fetchColumn();
            if ($null !== false) $db->exec("ALTER TABLE `$t` MODIFY `$c` VARCHAR(30) " . ($null === 'NO' ? 'NOT NULL' : 'NULL'));
        } catch (Throwable $e) {}
    }
    // Staged sales line items (entered via "Bill by Product"), billed later in one vendor bill
    $db->exec("CREATE TABLE IF NOT EXISTS sales_staged_items (
        id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        entry_date    DATE NOT NULL,
        vendor_id     INT UNSIGNED,
        vendor_name   VARCHAR(150),
        product_id    INT UNSIGNED,
        product_name  VARCHAR(150),
        no_of_bags    INT DEFAULT 0,
        weight        DECIMAL(10,2) DEFAULT 0,
        rate          DECIMAL(10,2) DEFAULT 0,
        is_billed     TINYINT(1) DEFAULT 0,
        sales_bill_id INT UNSIGNED NULL,
        created_by    INT UNSIGNED,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_vendor (vendor_id),
        INDEX idx_billed (is_billed),
        INDEX idx_date (entry_date)
    )");
    // Charge lines (Sakku / Cooli) are billed without a product — make sure product_id allows NULL.
    try {
        $nn = $db->query("SELECT IS_NULLABLE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_items' AND COLUMN_NAME = 'product_id'")->fetchColumn();
        if ($nn === 'NO') $db->exec("ALTER TABLE sales_items MODIFY product_id INT UNSIGNED NULL");
    } catch (Exception $e) { /* ignore — best effort */ }
    // Track print count (anti double-cash for reprints)
    try { $db->exec("ALTER TABLE sales_bills ADD COLUMN print_count INT NOT NULL DEFAULT 0"); } catch (PDOException $e) {}
    try { $db->exec("ALTER TABLE sales_bills ADD COLUMN last_printed_at DATETIME NULL DEFAULT NULL"); } catch (PDOException $e) {}
});

// ---- POST: mark bills as printed (increments print_count) ----
if ($method === 'POST' && $action === 'mark-printed') {
    $b = getBody();
    $ids = array_values(array_filter(array_map('intval', (array)($b['ids'] ?? []))));
    if (!$ids) respondError('ids required');
    $in = implode(',', array_fill(0, count($ids), '?'));
    $db->prepare("UPDATE sales_bills SET print_count = print_count + 1, last_printed_at = NOW() WHERE id IN ($in)")->execute($ids);
    respond(['marked' => count($ids)]);
}

// ---- POST: share a bill on WhatsApp (wa.me link + tokenized view link) ----
if ($method === 'POST' && $action === 'share') {
    $id = (int)(getBody()['id'] ?? 0);
    if (!$id) respondError('id required');
    $st = $db->prepare("SELECT sb.*, p.name_en AS party_name, p.name_ta AS party_name_ta, p.phone1
                        FROM sales_bills sb JOIN parties p ON sb.party_id = p.id WHERE sb.id = ?");
    $st->execute([$id]);
    $bill = $st->fetch();
    if (!$bill) respondError('Bill not found', 404);

    if (empty($bill['share_token'])) {
        $bill['share_token'] = bin2hex(random_bytes(16));
        $db->prepare("UPDATE sales_bills SET share_token = ? WHERE id = ?")->execute([$bill['share_token'], $id]);
    }
    $tpl   = companyTpl($db);
    $link  = baseUrl() . '/api/billview.php?t=' . $bill['share_token'];
    $dateD = date('d-m-Y', strtotime($bill['bill_date']));
    $msg = "*{$tpl['company_ta']}*\n"
         . "பில் எண்: {$bill['bill_no']} | தேதி: $dateD\n"
         . "திரு. {$bill['party_name']}" . ($bill['party_name_ta'] ? " / {$bill['party_name_ta']}" : "") . "\n"
         . "பில் தொகை: ₹" . number_format((float)$bill['net_amount'], 2) . "\n"
         . "நிலுவை / Balance: ₹" . number_format((float)$bill['balance_due'], 2) . "\n"
         . "பில் பார்க்க / View bill:\n$link\n"
         . $tpl['greeting'];
    $phone = waPhone($bill['phone1'] ?? '');
    respond([
        'wa_url'  => $phone ? "https://wa.me/$phone?text=" . rawurlencode($msg) : null,
        'message' => $msg, 'link' => $link, 'phone' => $phone,
    ]);
}

// ---- POST: share a payment receipt on WhatsApp (text only) ----
// body: { id } = payments_received.id. Includes the vendor's remaining outstanding.
if ($method === 'POST' && $action === 'share-receipt') {
    $id = (int)(getBody()['id'] ?? 0);
    if (!$id) respondError('id required');
    $st = $db->prepare("SELECT pr.*, p.name_en AS party_name, p.name_ta AS party_name_ta, p.phone1
                        FROM payments_received pr JOIN parties p ON pr.party_id = p.id WHERE pr.id = ?");
    $st->execute([$id]);
    $pay = $st->fetch();
    if (!$pay) respondError('Receipt not found', 404);

    $out = 0.0;
    try {
        $ob = $db->prepare("SELECT COALESCE(SUM(balance_due),0) FROM sales_bills WHERE party_id = ? AND is_cancelled = 0");
        $ob->execute([$pay['party_id']]);
        $out = (float)$ob->fetchColumn();
    } catch (Throwable $e) {}

    $tpl   = companyTpl($db);
    $dateD = date('d-m-Y', strtotime($pay['receipt_date']));
    $msg = "*{$tpl['company_ta']}*\n"
         . "ரசீது / Receipt: {$pay['receipt_no']} | தேதி: $dateD\n"
         . "திரு. {$pay['party_name']}" . ($pay['party_name_ta'] ? " / {$pay['party_name_ta']}" : "") . "\n"
         . "*பெற்ற தொகை / Received: ₹" . number_format((float)$pay['amount'], 2) . "* ({$pay['payment_mode']})\n"
         . "மீதி நிலுவை / Balance due: ₹" . number_format($out, 2) . "\n"
         . "நன்றி! " . $tpl['greeting'];
    $phone = waPhone($pay['phone1'] ?? '');
    respond([
        'wa_url'  => $phone ? "https://wa.me/$phone?text=" . rawurlencode($msg) : null,
        'message' => $msg, 'phone' => $phone,
    ]);
}

// ---- GET: List sales bills ----
if ($method === 'GET' && $action === 'list') {
    $from    = getParam('from',    date('Y-m-d'));
    $to      = getParam('to',      date('Y-m-d'));
    $partyId = getParam('party_id');
    $status  = getParam('status');

    $productId = getParam('product_id');
    // When filtering by one product, surface that product's rate/weight/bags per bill.
    $selExtra = ""; $joinExtra = ""; $params = [];
    if ($productId) {
        $selExtra  = ", fp.f_weight, fp.f_bags, fp.f_amount, fp.f_rates";
        $joinExtra = " LEFT JOIN (SELECT bill_id, SUM(vendor_weight) f_weight, SUM(no_of_bags) f_bags,
                           SUM(gross_amount) f_amount, GROUP_CONCAT(DISTINCT sale_rate ORDER BY sale_rate) f_rates
                       FROM sales_items WHERE product_id = ? GROUP BY bill_id) fp ON fp.bill_id = sb.id";
        $params[] = $productId;
    }
    $sql = "SELECT sb.*, p.name_en AS party_name, p.name_ta AS party_name_ta,
                   p.phone1, u.username AS created_by_name$selExtra
            FROM sales_bills sb
            JOIN parties p ON sb.party_id = p.id
            LEFT JOIN users u ON sb.created_by = u.id$joinExtra
            WHERE sb.bill_date BETWEEN ? AND ? AND sb.is_cancelled = 0";
    $params[] = $from; $params[] = $to;

    if ($partyId) { $sql .= " AND sb.party_id = ?"; $params[] = $partyId; }
    if ($status)  { $sql .= " AND sb.payment_status = ?"; $params[] = $status; }
    if ($productId) {
        $sql .= " AND EXISTS (SELECT 1 FROM sales_items si WHERE si.bill_id = sb.id AND si.product_id = ?)";
        $params[] = $productId;
    }
    $sql .= " ORDER BY sb.bill_date DESC, sb.id DESC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

// ---- GET: Single sales bill ----
if ($method === 'GET' && $action === 'get') {
    $id = getParam('id');
    if (!$id) respondError('id required');

    $stmt = $db->prepare("SELECT sb.*, p.name_en AS party_name, p.name_ta AS party_name_ta,
                                 p.phone1, p.address, p.credit_days
                          FROM sales_bills sb
                          JOIN parties p ON sb.party_id = p.id
                          WHERE sb.id = ?");
    $stmt->execute([$id]);
    $bill = $stmt->fetch();
    if (!$bill) respondError('Bill not found', 404);

    // LEFT JOIN so charge lines (Sakku/Cooli, no product_id) still appear; their name lives in notes.
    $stmt = $db->prepare("SELECT si.*, COALESCE(pr.name_en, si.notes) AS product_name, pr.name_ta AS product_name_ta,
                                 pr.code AS product_code, COALESCE(pr.unit_type, si.unit_type) AS unit_type
                          FROM sales_items si
                          LEFT JOIN products pr ON si.product_id = pr.id
                          WHERE si.bill_id = ? ORDER BY si.id");
    $stmt->execute([$id]);
    $bill['items'] = $stmt->fetchAll();

    // Payments received against this bill
    $stmt = $db->prepare("SELECT pr.*, pa.allocated_amt
                          FROM payment_allocations pa
                          JOIN payments_received pr ON pa.payment_id = pr.id
                          WHERE pa.sales_bill_id = ? ORDER BY pr.receipt_date");
    $stmt->execute([$id]);
    $bill['payments'] = $stmt->fetchAll();

    respond($bill);
}

// ---- POST: Create sales bill ----
if ($method === 'POST' && $action === 'save') {
    $b     = getBody();
    $items = $b['items'] ?? [];

    if (empty($b['party_id'])) respondError('Customer/Vendor required');
    if (empty($items))         respondError('At least one item required');

    // Get party credit days
    $party = $db->prepare("SELECT credit_days FROM parties WHERE id = ?");
    $party->execute([$b['party_id']]);
    $partyRow   = $party->fetch();
    $creditDays = (int)($b['credit_days'] ?? $partyRow['credit_days'] ?? businessRules()['credit_days']);

    $billDate = $b['bill_date'] ?? businessDate();
    assertDateUnlocked($billDate);

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $billNo   = nextBillNo('SAL', $billDate);
        $dueDate  = date('Y-m-d', strtotime($billDate . " +$creditDays days"));
        $discPct  = (float)($b['discount_pct'] ?? 0);

        $subtotalWeight = 0;
        $subtotalAmount = 0;
        $totalDiscount  = 0;
        $totalSakku     = 0;
        $totalCooly     = 0;
        $totalMargin    = 0;
        $processedItems = [];

        foreach ($items as $item) {
            // Charge line (Sakku / Cooli): no product, amount passed through as-is, no margin/deductions.
            if (!empty($item['is_charge'])) {
                $chargeAmt = round((float)($item['gross_amount'] ?? 0), 2);
                $subtotalAmount += $chargeAmt;
                $processedItems[] = [
                    'purchase_item_id' => null, 'product_id' => null,
                    'no_of_bags' => (int)($item['no_of_bags'] ?? 0),
                    'vendor_weight' => (float)($item['vendor_weight'] ?? 0), 'purchase_weight' => 0, 'weight_profit' => 0,
                    'unit_type' => $item['unit_type'] ?? 'KG', 'purchase_rate' => 0,
                    'sale_rate' => (float)($item['sale_rate'] ?? 0), 'gross_amount' => $chargeAmt,
                    'discount_pct' => 0, 'discount_amt' => 0, 'sakku_qty' => 0, 'sakku_rate' => 0, 'sakku_amt' => 0,
                    'cooly_amt' => 0, 'net_amount' => $chargeAmt, 'margin_amount' => 0,
                    'notes' => $item['product_name'] ?? 'Charge',
                ];
                continue;
            }
            $vendorWt    = (float)($item['vendor_weight']   ?? 0);
            $purWt       = (float)($item['purchase_weight'] ?? 0);
            $wtProfit    = round($vendorWt - $purWt, 2);
            $saleRate    = (float)($item['sale_rate']       ?? 0);
            $purRate     = (float)($item['purchase_rate']   ?? 0);
            $qty         = strtoupper($item['unit_type'] ?? 'KG') === 'BAG' ? (float)($item['no_of_bags'] ?? 0) : $vendorWt;
            $grossAmt    = round($qty * $saleRate, 2);
            $itemDiscPct = (float)($item['discount_pct']    ?? $discPct);
            $itemDiscAmt = round($grossAmt * $itemDiscPct / 100, 2);
            $sakkuAmt    = round((float)($item['sakku_qty'] ?? 0) * (float)($item['sakku_rate'] ?? 0), 2);
            $coolyAmt    = (float)($item['cooly_amt']       ?? 0);
            $netAmt      = round($grossAmt - $itemDiscAmt - $sakkuAmt - $coolyAmt, 2);

            // Margin = (sale_rate - purchase_rate) * vendor_weight + weight_profit * purchase_rate
            $rateMargin  = round(($saleRate - $purRate) * $qty, 2);
            $wtMargin    = round($wtProfit * $purRate, 2);
            $margin      = $rateMargin + $wtMargin - $itemDiscAmt;

            $subtotalWeight += $vendorWt;
            $subtotalAmount += $grossAmt;
            $totalDiscount  += $itemDiscAmt;
            $totalSakku     += $sakkuAmt;
            $totalCooly     += $coolyAmt;
            $totalMargin    += $margin;

            $processedItems[] = [
                'purchase_item_id' => $item['purchase_item_id'] ?? null,
                'product_id'       => $item['product_id'],
                'no_of_bags'       => $item['no_of_bags']       ?? 1,
                'vendor_weight'    => $vendorWt,
                'purchase_weight'  => $purWt,
                'weight_profit'    => $wtProfit,
                'unit_type'        => $item['unit_type']         ?? 'KG',
                'purchase_rate'    => $purRate,
                'sale_rate'        => $saleRate,
                'gross_amount'     => $grossAmt,
                'discount_pct'     => $itemDiscPct,
                'discount_amt'     => $itemDiscAmt,
                'sakku_qty'        => $item['sakku_qty']         ?? 0,
                'sakku_rate'       => $item['sakku_rate']        ?? 0,
                'sakku_amt'        => $sakkuAmt,
                'cooly_amt'        => $coolyAmt,
                'net_amount'       => $netAmt,
                'margin_amount'    => $margin,
                'notes'            => $item['notes']             ?? null,
            ];
        }

        $netAmount = round($subtotalAmount - $totalDiscount - $totalSakku - $totalCooly, 2);

        // Insert bill header
        $stmt = $db->prepare("INSERT INTO sales_bills
            (bill_no, bill_date, bill_time, party_id, salesman, credit_days, due_date,
             subtotal_weight, subtotal_amount, discount_pct, discount_amt,
             total_sakku_amt, total_cooly_amt, net_amount, balance_due,
             payment_status, notes, created_by)
            VALUES (?,?,NOW(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        $stmt->execute([
            $billNo, $billDate, $b['party_id'],
            $b['salesman']    ?? null,
            $creditDays, $dueDate,
            round($subtotalWeight, 2), round($subtotalAmount, 2),
            $discPct, round($totalDiscount, 2),
            round($totalSakku, 2), round($totalCooly, 2),
            $netAmount, $netAmount,
            'unpaid',
            $b['notes'] ?? null,
            $user['id']
        ]);
        $billId = $db->lastInsertId();

        // Store the vendor's outstanding balance just before this bill (for reprint accuracy).
        $openingBal = round((float)($b['opening_balance'] ?? 0), 2);
        if ($openingBal != 0) $db->prepare("UPDATE sales_bills SET opening_balance=? WHERE id=?")->execute([$openingBal, $billId]);

        // Amount the vendor paid now (shown as "credited" on the bill). The receipt itself
        // is recorded separately via action=payment so the outstanding math stays in one place.
        $credited = round((float)($b['credited'] ?? 0), 2);
        if ($credited > 0) $db->prepare("UPDATE sales_bills SET credited_amt=? WHERE id=?")->execute([$credited, $billId]);

        // Insert line items
        $iStmt = $db->prepare("INSERT INTO sales_items
            (bill_id, purchase_item_id, product_id, no_of_bags,
             vendor_weight, purchase_weight, weight_profit, unit_type,
             purchase_rate, sale_rate, gross_amount,
             discount_pct, discount_amt, sakku_qty, sakku_rate, sakku_amt,
             cooly_amt, net_amount, margin_amount, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");

        foreach ($processedItems as $pi) {
            $iStmt->execute([
                $billId, $pi['purchase_item_id'], $pi['product_id'], $pi['no_of_bags'],
                $pi['vendor_weight'], $pi['purchase_weight'], $pi['weight_profit'],
                $pi['unit_type'], $pi['purchase_rate'], $pi['sale_rate'],
                $pi['gross_amount'], $pi['discount_pct'], $pi['discount_amt'],
                $pi['sakku_qty'], $pi['sakku_rate'], $pi['sakku_amt'],
                $pi['cooly_amt'], $pi['net_amount'], $pi['margin_amount'], $pi['notes']
            ]);
        }

        // Ledger entry - Vendor owes us
        $db->prepare("INSERT INTO ledger
            (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
            VALUES (?, 'SALE', 'sales_bills', ?, ?, ?, ?, 0, ?)")
           ->execute([$billDate, $billId, $b['party_id'],
                      "Sales Bill $billNo", $netAmount, $user['id']]);

        auditLog('CREATE', 'sales_bill', $billId, "Sales bill $billNo", ['net_amount' => $netAmount, 'party_id' => $b['party_id'], 'items' => count($processedItems)]);
        if ($db->inTransaction()) { $db->commit(); }
        respond([
            'id'           => $billId,
            'bill_no'      => $billNo,
            'net_amount'   => $netAmount,
            'due_date'     => $dueDate,
            'total_margin' => round($totalMargin, 2),
            'action'       => 'created'
        ]);

    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to save bill', $e);
    }
}

// ---- POST: Update an existing sales bill (keeps the same bill number) ----
if ($method === 'POST' && $action === 'update') {
    $b     = getBody();
    $id    = $b['id'] ?? null;
    $items = $b['items'] ?? [];
    if (!$id)                   respondError('Bill id required');
    if (empty($b['party_id']))  respondError('Customer/Vendor required');
    if (empty($items))          respondError('At least one item required');

    $cur = $db->prepare("SELECT * FROM sales_bills WHERE id = ?");
    $cur->execute([$id]);
    $existing = $cur->fetch();
    if (!$existing)                            respondError('Bill not found', 404);
    if ((int)$existing['is_cancelled'] === 1)  respondError('Cannot edit a cancelled bill');

    $billDate = $b['bill_date'] ?? $existing['bill_date'];
    assertDateUnlocked($existing['bill_date'], $billDate);   // block if the old OR new day is locked

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $discPct  = (float)($b['discount_pct'] ?? 0);

        $subtotalWeight = 0; $subtotalAmount = 0; $totalDiscount = 0;
        $totalSakku = 0; $totalCooly = 0; $totalMargin = 0; $processedItems = [];

        foreach ($items as $item) {
            // Charge line (Sakku / Cooli): no product, amount passed through as-is, no margin/deductions.
            if (!empty($item['is_charge'])) {
                $chargeAmt = round((float)($item['gross_amount'] ?? 0), 2);
                $subtotalAmount += $chargeAmt;
                $processedItems[] = [
                    'purchase_item_id' => null, 'product_id' => null,
                    'no_of_bags' => (int)($item['no_of_bags'] ?? 0),
                    'vendor_weight' => (float)($item['vendor_weight'] ?? 0), 'purchase_weight' => 0, 'weight_profit' => 0,
                    'unit_type' => $item['unit_type'] ?? 'KG', 'purchase_rate' => 0,
                    'sale_rate' => (float)($item['sale_rate'] ?? 0), 'gross_amount' => $chargeAmt,
                    'discount_pct' => 0, 'discount_amt' => 0, 'sakku_qty' => 0, 'sakku_rate' => 0, 'sakku_amt' => 0,
                    'cooly_amt' => 0, 'net_amount' => $chargeAmt, 'margin_amount' => 0,
                    'notes' => $item['product_name'] ?? 'Charge',
                ];
                continue;
            }
            $vendorWt    = (float)($item['vendor_weight']   ?? 0);
            $purWt       = (float)($item['purchase_weight'] ?? 0);
            $wtProfit    = round($vendorWt - $purWt, 2);
            $saleRate    = (float)($item['sale_rate']       ?? 0);
            $purRate     = (float)($item['purchase_rate']   ?? 0);
            $qty         = strtoupper($item['unit_type'] ?? 'KG') === 'BAG' ? (float)($item['no_of_bags'] ?? 0) : $vendorWt;
            $grossAmt    = round($qty * $saleRate, 2);
            $itemDiscPct = (float)($item['discount_pct']    ?? $discPct);
            $itemDiscAmt = round($grossAmt * $itemDiscPct / 100, 2);
            $sakkuAmt    = round((float)($item['sakku_qty'] ?? 0) * (float)($item['sakku_rate'] ?? 0), 2);
            $coolyAmt    = (float)($item['cooly_amt']       ?? 0);
            $netAmt      = round($grossAmt - $itemDiscAmt - $sakkuAmt - $coolyAmt, 2);
            $margin      = round(($saleRate - $purRate) * $qty, 2) + round($wtProfit * $purRate, 2) - $itemDiscAmt;

            $subtotalWeight += $vendorWt; $subtotalAmount += $grossAmt;
            $totalDiscount  += $itemDiscAmt; $totalSakku += $sakkuAmt;
            $totalCooly     += $coolyAmt; $totalMargin += $margin;

            $processedItems[] = [
                'purchase_item_id' => $item['purchase_item_id'] ?? null, 'product_id' => $item['product_id'],
                'no_of_bags' => $item['no_of_bags'] ?? 1, 'vendor_weight' => $vendorWt,
                'purchase_weight' => $purWt, 'weight_profit' => $wtProfit, 'unit_type' => $item['unit_type'] ?? 'KG',
                'purchase_rate' => $purRate, 'sale_rate' => $saleRate, 'gross_amount' => $grossAmt,
                'discount_pct' => $itemDiscPct, 'discount_amt' => $itemDiscAmt, 'sakku_qty' => $item['sakku_qty'] ?? 0,
                'sakku_rate' => $item['sakku_rate'] ?? 0, 'sakku_amt' => $sakkuAmt, 'cooly_amt' => $coolyAmt,
                'net_amount' => $netAmt, 'margin_amount' => $margin, 'notes' => $item['notes'] ?? null,
            ];
        }

        $netAmount = round($subtotalAmount - $totalDiscount - $totalSakku - $totalCooly, 2);
        $paid      = (float)($existing['paid_amount'] ?? 0);
        $balance   = max(0, round($netAmount - $paid, 2));
        $status    = $balance <= 0 ? ($paid > 0 ? 'paid' : 'unpaid') : ($paid > 0 ? 'partial' : 'unpaid');

        $db->prepare("UPDATE sales_bills SET
                bill_date=?, party_id=?, salesman=?, subtotal_weight=?, subtotal_amount=?,
                discount_pct=?, discount_amt=?, total_sakku_amt=?, total_cooly_amt=?,
                net_amount=?, balance_due=?, payment_status=?, notes=?, updated_at=NOW()
            WHERE id=?")
           ->execute([
               $billDate, $b['party_id'], $b['salesman'] ?? null,
               round($subtotalWeight, 2), round($subtotalAmount, 2),
               $discPct, round($totalDiscount, 2), round($totalSakku, 2), round($totalCooly, 2),
               $netAmount, $balance, $status, $b['notes'] ?? null, $id
           ]);

        $db->prepare("DELETE FROM sales_items WHERE bill_id=?")->execute([$id]);
        $iStmt = $db->prepare("INSERT INTO sales_items
            (bill_id, purchase_item_id, product_id, no_of_bags,
             vendor_weight, purchase_weight, weight_profit, unit_type,
             purchase_rate, sale_rate, gross_amount,
             discount_pct, discount_amt, sakku_qty, sakku_rate, sakku_amt,
             cooly_amt, net_amount, margin_amount, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        foreach ($processedItems as $pi) {
            $iStmt->execute([
                $id, $pi['purchase_item_id'], $pi['product_id'], $pi['no_of_bags'],
                $pi['vendor_weight'], $pi['purchase_weight'], $pi['weight_profit'],
                $pi['unit_type'], $pi['purchase_rate'], $pi['sale_rate'],
                $pi['gross_amount'], $pi['discount_pct'], $pi['discount_amt'],
                $pi['sakku_qty'], $pi['sakku_rate'], $pi['sakku_amt'],
                $pi['cooly_amt'], $pi['net_amount'], $pi['margin_amount'], $pi['notes']
            ]);
        }

        // Rebuild the SALE ledger entry (payments/allocations left untouched)
        $db->prepare("DELETE FROM ledger WHERE ref_type='sales_bills' AND ref_id=?")->execute([$id]);
        $db->prepare("INSERT INTO ledger
            (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
            VALUES (?, 'SALE', 'sales_bills', ?, ?, ?, ?, 0, ?)")
           ->execute([$billDate, $id, $b['party_id'], "Sales Bill {$existing['bill_no']}", $netAmount, $user['id']]);

        auditLog('UPDATE', 'sales_bill', $id, "Sales bill {$existing['bill_no']}", ['net_old' => (float)$existing['net_amount'], 'net_new' => $netAmount]);
        if ($db->inTransaction()) { $db->commit(); }
        respond([
            'id'           => $id,
            'bill_no'      => $existing['bill_no'],
            'net_amount'   => $netAmount,
            'balance_due'  => $balance,
            'total_margin' => round($totalMargin, 2),
            'action'       => 'updated'
        ]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to update bill', $e);
    }
}

// ---- POST: Cancel (delete) a sales bill ----
if ($method === 'POST' && $action === 'cancel') {
    $b  = getBody();
    $id = $b['id'] ?? null;
    if (!$id) respondError('Bill id required');

    $cd = $db->prepare("SELECT bill_date, paid_amount FROM sales_bills WHERE id=?");
    $cd->execute([$id]);
    $row = $cd->fetch();
    if (!$row) respondError('Bill not found', 404);
    assertDateUnlocked($row['bill_date']);
    if ((float)($row['paid_amount'] ?? 0) > 0.001) {
        respondError('This bill has a payment applied. Remove the payment first (Payments screen), then delete the bill.', 409);
    }

    // cancel_reason may not exist on older installs — add it once, best effort.
    try { $db->exec("ALTER TABLE sales_bills ADD COLUMN cancel_reason VARCHAR(200) NULL"); } catch (Exception $e) { /* already there */ }

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $db->prepare("UPDATE sales_bills SET is_cancelled=1, cancel_reason=? WHERE id=?")
           ->execute([$b['reason'] ?? 'Deleted', $id]);
        // Reverse the SALE ledger entry
        $db->prepare("DELETE FROM ledger WHERE ref_type='sales_bills' AND ref_id=?")->execute([$id]);
        // Return any staged / yard items to the pending queue so they can be re-billed
        $db->prepare("UPDATE sales_staged_items SET is_billed=0, sales_bill_id=NULL WHERE sales_bill_id=?")->execute([$id]);
        $db->prepare("UPDATE yard_allocations  SET is_billed=0, sales_bill_id=NULL WHERE sales_bill_id=?")->execute([$id]);
        auditLog('VOID', 'sales_bill', $id, "Cancelled sales bill", ['reason' => $b['reason'] ?? 'Deleted']);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['id' => $id, 'action' => 'cancelled']);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to delete bill', $e);
    }
}

// ---- POST: Stage sales line items (from "Bill by Product") — billed later in one vendor bill ----
if ($method === 'POST' && $action === 'stage') {
    $b     = getBody();
    $items = $b['items'] ?? [];
    if (empty($items)) respondError('No items to stage');
    $date = $b['entry_date'] ?? businessDate();
    assertDateUnlocked($date);

    $ins = $db->prepare("INSERT INTO sales_staged_items
        (entry_date, vendor_id, vendor_name, product_id, product_name, no_of_bags, weight, rate, created_by)
        VALUES (?,?,?,?,?,?,?,?,?)");
    $count = 0;
    foreach ($items as $it) {
        if (empty($it['vendor_id'])) continue;
        $ins->execute([
            $date, $it['vendor_id'], $it['vendor_name'] ?? '',
            $it['product_id'] ?? null, $it['product_name'] ?? '',
            intval($it['no_of_bags'] ?? 0), round((float)($it['weight'] ?? 0), 2),
            round((float)($it['rate'] ?? 0), 2), $user['id'],
        ]);
        $count++;
    }
    respond(['staged' => $count, 'action' => 'staged']);
}

// ---- GET: Customers already entered for a product on a date (Bill-by-Product "already added") ----
// Pending rows come from the staged draft; BILLED rows are read live from the actual bills, so any
// later edit to a bill — quantity, weight, rate, or even changing the product on a line — is
// reflected here automatically (the bill is the single source of truth, no snapshot to keep in sync).
if ($method === 'GET' && $action === 'product-customers') {
    $pid  = getParam('product_id');
    $date = getParam('date');
    if (!$pid || !$date) respondError('product_id and date required');

    // Not-yet-billed drafts
    $draft = $db->prepare("SELECT CONCAT('s', id) AS id, vendor_id, vendor_name,
                                  no_of_bags, weight, rate, 0 AS is_billed, NULL AS sales_bill_id
                           FROM sales_staged_items
                           WHERE product_id = ? AND entry_date = ? AND is_billed = 0");
    $draft->execute([$pid, $date]);

    // Billed — taken from the bills themselves so edits always show through
    $billed = $db->prepare("SELECT CONCAT('b', si.id) AS id, sb.party_id AS vendor_id,
                                   p.name_en AS vendor_name, si.no_of_bags,
                                   si.vendor_weight AS weight, si.sale_rate AS rate,
                                   1 AS is_billed, si.bill_id AS sales_bill_id
                            FROM sales_items si
                            JOIN sales_bills sb ON si.bill_id = sb.id
                            JOIN parties p ON sb.party_id = p.id
                            WHERE si.product_id = ? AND sb.bill_date = ? AND sb.is_cancelled = 0");
    $billed->execute([$pid, $date]);

    $rows = array_merge($draft->fetchAll(), $billed->fetchAll());
    usort($rows, fn($a, $b) => strcmp($a['vendor_name'] ?? '', $b['vendor_name'] ?? ''));
    respondList($rows);
}

// ---- GET: List staged sales items (default: unbilled) ----
if ($method === 'GET' && $action === 'staged') {
    $sql = "SELECT * FROM sales_staged_items WHERE 1=1";
    $params = [];
    $billed = getParam('billed', '');
    if ($billed === 'all')      { /* both billed and unbilled */ }
    elseif ($billed !== '')     { $sql .= " AND is_billed = ?"; $params[] = (int)$billed; }
    else                        { $sql .= " AND is_billed = 0"; }
    if ($v = getParam('vendor_id'))     { $sql .= " AND vendor_id = ?"; $params[] = $v; }
    if ($p = getParam('product_id'))    { $sql .= " AND product_id = ?"; $params[] = $p; }
    if ($d = getParam('date'))          { $sql .= " AND entry_date = ?"; $params[] = $d; }
    $sql .= " ORDER BY vendor_name, id";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

// ---- POST: Mark staged items as billed ----
if ($method === 'POST' && $action === 'mark-staged-billed') {
    $b       = getBody();
    $billId  = $b['sales_bill_id'] ?? null;
    // Preferred: client sends the final billed values per staged id, so the staged snapshot
    // is corrected to match what was actually billed (a row may be edited at billing time).
    $items = $b['items'] ?? null;
    if (is_array($items) && count($items)) {
        $upd = $db->prepare("UPDATE sales_staged_items
                             SET is_billed=1, sales_bill_id=?, no_of_bags=?, weight=?, rate=?
                             WHERE id=?");
        $ids = [];
        foreach ($items as $it) {
            $sid = (int)($it['id'] ?? 0);
            if (!$sid) continue;
            $upd->execute([$billId, (int)($it['no_of_bags'] ?? 0),
                           round((float)($it['weight'] ?? 0), 2),
                           round((float)($it['rate'] ?? 0), 2), $sid]);
            $ids[] = $sid;
        }
        respond(['ids' => $ids, 'action' => 'billed']);
    }
    // Backward-compatible: ids-only marking (older clients).
    $ids = $b['ids'] ?? [];
    if (empty($ids)) respondError('ids required');
    $ids = array_map('intval', $ids);
    $place = implode(',', array_fill(0, count($ids), '?'));
    $db->prepare("UPDATE sales_staged_items SET is_billed=1, sales_bill_id=? WHERE id IN ($place)")
       ->execute(array_merge([$billId], $ids));
    respond(['ids' => $ids, 'action' => 'billed']);
}

// ---- POST: Delete an UNBILLED staged item (Bill-by-Product pending) ----
if ($method === 'POST' && $action === 'delete-staged') {
    $id = (int)(getBody()['id'] ?? 0);
    if (!$id) respondError('id required');
    $st = $db->prepare("SELECT entry_date, is_billed FROM sales_staged_items WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) respondError('Pending item not found', 404);
    if ((int)$row['is_billed'] === 1) respondError('Already billed — delete the bill instead.', 409);
    assertDateUnlocked($row['entry_date']);
    $db->prepare("DELETE FROM sales_staged_items WHERE id=? AND is_billed=0")->execute([$id]);
    auditLog('DELETE', 'staged_item', $id, 'Deleted pending staged item');
    respond(['action' => 'deleted', 'id' => $id]);
}

// ---- POST: Discount or adjustment against a vendor (no cash) ----
// body: { party_id, amount, kind: 'discount'|'adjustment', note, date }
// Reduces the vendor's outstanding; recorded in the ledger as a credit.
// ---- POST: Delete (void) a vendor payment — restores the bills it was applied to ----
// body: { payment_id }
if ($method === 'POST' && $action === 'delete-payment') {
    $b = getBody();
    $pid = (int)($b['payment_id'] ?? 0);
    if (!$pid) respondError('payment_id required');

    $pr = $db->prepare("SELECT * FROM payments_received WHERE id=?");
    $pr->execute([$pid]);
    $pay = $pr->fetch();
    if (!$pay) respondError('Payment not found', 404);
    assertDateUnlocked($pay['receipt_date']);

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // Restore each bill this payment was allocated to
        $allocStmt = $db->prepare("SELECT sales_bill_id, allocated_amt FROM payment_allocations WHERE payment_id=?");
        $allocStmt->execute([$pid]);
        $allocs = $allocStmt->fetchAll();
        $allocTotal = 0;
        foreach ($allocs as $a) {
            $amt = (float)$a['allocated_amt'];
            $allocTotal += $amt;
            $bs = $db->prepare("SELECT balance_due, paid_amount FROM sales_bills WHERE id=?");
            $bs->execute([$a['sales_bill_id']]);
            $bill = $bs->fetch();
            if (!$bill) continue;
            $newBal  = (float)$bill['balance_due'] + $amt;
            $newPaid = max(0, (float)$bill['paid_amount'] - $amt);
            $status  = $newPaid <= 0 ? 'unpaid' : ($newBal > 0 ? 'partial' : 'paid');
            $db->prepare("UPDATE sales_bills SET balance_due=?, paid_amount=?, payment_status=? WHERE id=?")
               ->execute([$newBal, $newPaid, $status, $a['sales_bill_id']]);
        }
        $db->prepare("DELETE FROM payment_allocations WHERE payment_id=?")->execute([$pid]);

        // If the payment also carried a discount (alloc total > cash amount), void that discount ledger entry
        $discPortion = round($allocTotal - (float)$pay['amount'], 2);
        if ($discPortion > 0.01) {
            $db->prepare("DELETE FROM ledger WHERE txn_type='DISCOUNT' AND party_id=? AND ABS(credit-?)<0.01 AND txn_date=? LIMIT 1")
               ->execute([$pay['party_id'], $discPortion, $pay['receipt_date']]);
        }

        // Remove the cash ledger entry and the receipt itself
        $db->prepare("DELETE FROM ledger WHERE ref_type='payments_received' AND ref_id=?")->execute([$pid]);
        $db->prepare("DELETE FROM payments_received WHERE id=?")->execute([$pid]);

        auditLog('DELETE', 'payment_received', $pid, "Voided receipt {$pay['receipt_no']}", ['amount' => (float)$pay['amount'], 'restored' => round($allocTotal, 2)]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['action' => 'deleted', 'receipt_no' => $pay['receipt_no'], 'restored' => round($allocTotal, 2)]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to delete payment', $e);
    }
}

// ---- GET: Recent discounts & adjustments (from the ledger) ----
if ($method === 'GET' && $action === 'adjustments-list') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    $party = getParam('party_id');
    $sql = "SELECT l.id, l.txn_date, l.txn_type, l.credit AS amount, l.description, l.party_id,
                   p.name_en AS party_name, p.name_ta AS party_name_ta
            FROM ledger l JOIN parties p ON l.party_id = p.id
            WHERE l.txn_type IN ('DISCOUNT','ADJUSTMENT') AND l.txn_date BETWEEN ? AND ?";
    $params = [$from, $to];
    if ($party) { $sql .= " AND l.party_id = ?"; $params[] = $party; }
    $sql .= " ORDER BY l.txn_date DESC, l.id DESC";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    respondList($stmt->fetchAll());
}

// ---- POST: Delete (void) a discount/adjustment — adds the amount back to the vendor's bills ----
// body: { ledger_id }
if ($method === 'POST' && $action === 'delete-adjustment') {
    $b = getBody();
    $lid = (int)($b['ledger_id'] ?? 0);
    if (!$lid) respondError('ledger_id required');

    $ls = $db->prepare("SELECT * FROM ledger WHERE id=? AND txn_type IN ('DISCOUNT','ADJUSTMENT')");
    $ls->execute([$lid]);
    $entry = $ls->fetch();
    if (!$entry) respondError('Entry not found', 404);
    assertDateUnlocked($entry['txn_date']);
    $amount  = (float)$entry['credit'];
    $partyId = $entry['party_id'];

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // Add the amount back to the bills it had reduced (same oldest-first order it was applied)
        $remaining = $amount;
        $bills = $db->prepare("SELECT id, balance_due, paid_amount FROM sales_bills
                               WHERE party_id=? AND is_cancelled=0 AND paid_amount > 0
                               ORDER BY bill_date ASC, id ASC");
        $bills->execute([$partyId]);
        foreach ($bills->fetchAll() as $bill) {
            if ($remaining <= 0) break;
            $addBack = min($remaining, (float)$bill['paid_amount']);
            $remaining -= $addBack;
            $newBal  = (float)$bill['balance_due'] + $addBack;
            $newPaid = (float)$bill['paid_amount'] - $addBack;
            $status  = $newPaid <= 0 ? 'unpaid' : ($newBal > 0 ? 'partial' : 'paid');
            $db->prepare("UPDATE sales_bills SET balance_due=?, paid_amount=?, payment_status=? WHERE id=?")
               ->execute([$newBal, $newPaid, $status, $bill['id']]);
        }
        $db->prepare("DELETE FROM ledger WHERE id=?")->execute([$lid]);
        auditLog('DELETE', strtolower($entry['txn_type']), $lid, "Voided {$entry['txn_type']}", ['amount' => $amount, 'party_id' => $partyId, 'restored' => round($amount - $remaining, 2)]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['action' => 'deleted', 'kind' => strtolower($entry['txn_type']), 'restored' => round($amount - $remaining, 2)]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to delete', $e);
    }
}

if ($method === 'POST' && $action === 'adjust') {
    $b = getBody();
    if (empty($b['party_id'])) respondError('Party required');
    $amount = (float)($b['amount'] ?? 0);
    if ($amount <= 0) respondError('Amount required');
    $kind = ($b['kind'] ?? 'discount') === 'adjustment' ? 'ADJUSTMENT' : 'DISCOUNT';
    $date = $b['date'] ?? businessDate();
    assertDateUnlocked($date);
    $note = $b['note'] ?? ($kind === 'DISCOUNT' ? 'Discount given' : 'Adjustment');

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // Reduce balance on the vendor's open bills (oldest first)
        $remaining = $amount;
        $bills = $db->prepare("SELECT id, balance_due FROM sales_bills
                               WHERE party_id=? AND payment_status IN ('unpaid','partial','overdue') AND is_cancelled=0
                               ORDER BY bill_date ASC, id ASC");
        $bills->execute([$b['party_id']]);
        foreach ($bills->fetchAll() as $bill) {
            if ($remaining <= 0) break;
            $alloc = min($remaining, (float)$bill['balance_due']);
            $remaining -= $alloc;
            $newBal = (float)$bill['balance_due'] - $alloc;
            $status = $newBal <= 0 ? 'paid' : 'partial';
            $db->prepare("UPDATE sales_bills SET balance_due=?, paid_amount=paid_amount+?, payment_status=? WHERE id=?")
               ->execute([$newBal, $alloc, $status, $bill['id']]);
        }
        $db->prepare("INSERT INTO ledger (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
                      VALUES (?, ?, 'adjustment', NULL, ?, ?, 0, ?, ?)")
           ->execute([$date, $kind, $b['party_id'], $note, $amount, $user['id']]);
        auditLog('CREATE', strtolower($kind), $b['party_id'], "$kind: $note", ['amount' => $amount, 'party_id' => $b['party_id'], 'applied' => round($amount - $remaining, 2)]);
        if ($db->inTransaction()) { $db->commit(); }
        respond(['action' => strtolower($kind), 'amount' => $amount, 'applied' => round($amount - $remaining, 2)]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed', $e);
    }
}

// ---- POST: Record payment from vendor (with optional discount given) ----
if ($method === 'POST' && $action === 'payment') {
    $b = getBody();
    if (empty($b['party_id']))    respondError('Party required');
    $amount   = (float)($b['amount'] ?? 0);
    $discount = (float)($b['discount'] ?? 0);
    if ($amount <= 0 && $discount <= 0) respondError('Enter a collected amount and/or discount');

    $date = $b['receipt_date'] ?? businessDate();
    assertDateUnlocked($date);

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        $receiptNo = nextBillNo('REC', $date);

        $paymentId = null;
        if ($amount > 0) {
            $db->prepare("INSERT INTO payments_received
                (receipt_no, receipt_date, party_id, amount, discount_amt, payment_mode, payment_ref, bank_name, notes, created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?)")
               ->execute([
                   $receiptNo, $date, $b['party_id'], $amount, $discount,
                   $b['payment_mode'] ?? 'cash',
                   $b['payment_ref']  ?? null,
                   $b['bank_name']    ?? null,
                   $b['notes']        ?? null,
                   $user['id']
               ]);
            $paymentId = $db->lastInsertId();
        }

        // Allocate cash + discount to bills (oldest first) — both reduce what the vendor owes
        $remaining = $amount + $discount;
        if ($remaining > 0) {
            $bills = $db->prepare("SELECT id, balance_due FROM sales_bills
                                   WHERE party_id = ? AND payment_status IN ('unpaid','partial','overdue')
                                     AND is_cancelled = 0
                                   ORDER BY bill_date ASC, id ASC");
            $bills->execute([$b['party_id']]);

            foreach ($bills->fetchAll() as $bill) {
                if ($remaining <= 0) break;
                $allocate = min($remaining, $bill['balance_due']);
                $remaining -= $allocate;

                if ($paymentId) {
                    $db->prepare("INSERT INTO payment_allocations (payment_id, sales_bill_id, allocated_amt)
                                  VALUES (?,?,?)")->execute([$paymentId, $bill['id'], $allocate]);
                }
                $newBalance = $bill['balance_due'] - $allocate;
                $status     = $newBalance <= 0 ? 'paid' : 'partial';
                $db->prepare("UPDATE sales_bills SET balance_due=?, paid_amount=paid_amount+?,
                              payment_status=? WHERE id=?")
                   ->execute([$newBalance, $allocate, $status, $bill['id']]);
            }
        }

        // Ledger - cash received
        if ($amount > 0) {
            $db->prepare("INSERT INTO ledger
                (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
                VALUES (?, 'PAYMENT_IN', 'payments_received', ?, ?, ?, 0, ?, ?)")
               ->execute([$date, $paymentId, $b['party_id'],
                          "Payment Receipt $receiptNo", $amount, $user['id']]);
        }
        // Ledger - discount given (reduces what they owe, no cash)
        if ($discount > 0) {
            $db->prepare("INSERT INTO ledger
                (txn_date, txn_type, ref_type, ref_id, party_id, description, debit, credit, created_by)
                VALUES (?, 'DISCOUNT', 'discount', NULL, ?, ?, 0, ?, ?)")
               ->execute([$date, $b['party_id'], "Discount given", $discount, $user['id']]);
        }

        auditLog('CREATE', 'payment_received', $paymentId ?: $b['party_id'], $amount > 0 ? "Receipt $receiptNo" : "Discount on collection", ['amount' => $amount, 'discount' => $discount, 'party_id' => $b['party_id'], 'mode' => $b['payment_mode'] ?? 'cash']);
        if ($db->inTransaction()) { $db->commit(); }
        respond([
            'id'         => $paymentId,
            'receipt_no' => $amount > 0 ? $receiptNo : null,
            'amount'     => $amount,
            'discount'   => $discount,
            'unallocated'=> max(0, $remaining),
            'action'     => 'created'
        ]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed to record payment', $e);
    }
}

// ---- GET: Daily sales summary ----
if ($method === 'GET' && $action === 'summary') {
    $date = getParam('date', date('Y-m-d'));
    $stmt = $db->prepare("
        SELECT
            COUNT(*)                AS bill_count,
            SUM(subtotal_weight)    AS total_weight,
            SUM(subtotal_amount)    AS gross_sales,
            SUM(discount_amt)       AS total_discounts,
            SUM(net_amount)         AS net_sales
        FROM sales_bills
        WHERE bill_date = ? AND is_cancelled = 0
    ");
    $stmt->execute([$date]);
    respond($stmt->fetch());
}

// ---- GET: Aging report ----
if ($method === 'GET' && $action === 'aging') {
    $stmt = $db->query("
        SELECT aging_bucket,
               COUNT(*) AS bill_count,
               COUNT(DISTINCT party_id) AS vendor_count,
               SUM(balance_due) AS total_due
        FROM vw_vendor_outstanding
        GROUP BY aging_bucket
        ORDER BY FIELD(aging_bucket,'Current','1-15 Days','16-30 Days','31-60 Days','Over 60 Days')
    ");
    respond($stmt->fetchAll());
}

respondError('Invalid action', 400);
