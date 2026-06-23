<?php
// ============================================================
//  IDNUK SOFTWARE - Tally / Day Book API
//  GET /api/tally?action=daybook&date=YYYY-MM-DD
//  Opening (cash+bank) carried forward + day's collections (credit),
//  farmer payouts & expenses (debit), closing balance, and memos.
// ============================================================
require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'daybook');
$db     = getDB();

// Ensure the payouts journal exists (also created by purchase.php — same migration key)
migrateOnce('farmer_payouts', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS farmer_payouts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, pay_date DATE NOT NULL, party_id INT UNSIGNED,
        party_name VARCHAR(150), amount DECIMAL(12,2) DEFAULT 0, mode VARCHAR(20) DEFAULT 'cash',
        bank_name VARCHAR(80) NULL, payment_ref VARCHAR(60) NULL, purchase_bill_id INT UNSIGNED NULL,
        created_by INT UNSIGNED, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_date (pay_date))");
});

// Ensure the farmer-advances journal exists (also created by purchase.php — same migration key)
migrateOnce('farmer_advances', 1, function ($db) {
    $db->exec("CREATE TABLE IF NOT EXISTS farmer_advances (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, advance_date DATE NOT NULL, party_id INT UNSIGNED,
        party_name VARCHAR(150), amount DECIMAL(12,2) DEFAULT 0, adjusted_amt DECIMAL(12,2) DEFAULT 0,
        mode VARCHAR(20) DEFAULT 'cash', bank_name VARCHAR(80) NULL, payment_ref VARCHAR(60) NULL,
        notes VARCHAR(200) NULL, status VARCHAR(20) DEFAULT 'open', created_by INT UNSIGNED,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_date (advance_date), INDEX idx_party (party_id))");
});

// Cash/bank split of a money source over [from, toExcl)
function rangeSplit(PDO $db, string $table, string $dateCol, string $modeCol, string $from, string $toExcl, string $amountCol = 'amount'): array {
    try {
        $stmt = $db->prepare("SELECT
            COALESCE(SUM(CASE WHEN $modeCol = 'cash' THEN $amountCol ELSE 0 END),0) AS cash,
            COALESCE(SUM(CASE WHEN $modeCol <> 'cash' THEN $amountCol ELSE 0 END),0) AS bank
            FROM $table WHERE $dateCol >= ? AND $dateCol < ?");
        $stmt->execute([$from, $toExcl]);
        $r = $stmt->fetch();
        return ['cash' => (float)$r['cash'], 'bank' => (float)$r['bank']];
    } catch (PDOException $e) { return ['cash' => 0, 'bank' => 0]; }   // table not present yet
}

function listSplit(array $rows): array {
    $c = 0; $b = 0;
    foreach ($rows as $r) {
        if (($r['mode'] ?? 'cash') === 'cash') $c += (float)$r['amount']; else $b += (float)$r['amount'];
    }
    return ['cash' => round($c, 2), 'bank' => round($b, 2), 'total' => round($c + $b, 2)];
}

if ($method === 'GET' && $action === 'daybook') {
    $date = getParam('date', date('Y-m-d'));

    // Opening config
    $os = $db->prepare("SELECT sval FROM app_settings WHERE skey = 'opening_balance'");
    $os->execute();
    $cfg = ($r = $os->fetch()) ? json_decode($r['sval'], true) : null;
    $asOf       = $cfg['as_of'] ?? '2000-01-01';
    $openCashCfg = (float)($cfg['cash'] ?? 0);
    $banks      = $cfg['banks'] ?? [];
    $openBankCfg = array_sum(array_map(fn($x) => (float)($x['amount'] ?? 0), $banks));

    // Movements between the opening date and the start of this day → opening for `date`
    $collPrev = rangeSplit($db, 'payments_received', 'receipt_date', 'payment_mode', $asOf, $date);
    $expPrev  = rangeSplit($db, 'daily_expenses',    'expense_date', 'payment_mode', $asOf, $date);
    $payPrev  = rangeSplit($db, 'farmer_payouts',    'pay_date',     'mode',         $asOf, $date);
    $mktPrev  = rangeSplit($db, 'market_settlements', 'settle_date', 'payment_mode', $asOf, $date, 'amount_paid');
    $advPrev  = rangeSplit($db, 'farmer_advances',   'advance_date', 'mode',         $asOf, $date);
    $openCash = round($openCashCfg + $collPrev['cash'] - $expPrev['cash'] - $payPrev['cash'] - $mktPrev['cash'] - $advPrev['cash'], 2);
    $openBank = round($openBankCfg + $collPrev['bank'] - $expPrev['bank'] - $payPrev['bank'] - $mktPrev['bank'] - $advPrev['bank'], 2);

    // Day movements
    $coll = $db->prepare("SELECT pr.receipt_no, pr.amount, pr.payment_mode AS mode, pr.bank_name, pr.payment_ref,
                                 p.name_en AS party_name, p.city
                          FROM payments_received pr JOIN parties p ON pr.party_id = p.id
                          WHERE pr.receipt_date = ? ORDER BY pr.id");
    $coll->execute([$date]);
    $collections = $coll->fetchAll();

    $pay = $db->prepare("SELECT party_name, amount, mode, bank_name, payment_ref, purchase_bill_id
                         FROM farmer_payouts WHERE pay_date = ? ORDER BY id");
    $pay->execute([$date]);
    $payouts = $pay->fetchAll();

    $exp = $db->prepare("SELECT de.description, de.amount, de.payment_mode AS mode, ec.name_en AS category
                         FROM daily_expenses de LEFT JOIN expense_categories ec ON de.category_id = ec.id
                         WHERE de.expense_date = ? ORDER BY de.id");
    $exp->execute([$date]);
    $expenses = $exp->fetchAll();

    // Farmer advances given today (crop-support cash given before goods arrive)
    $advances = [];
    try {
        $adv = $db->prepare("SELECT id, party_id, party_name, amount, adjusted_amt, mode, bank_name, payment_ref, notes
                             FROM farmer_advances WHERE advance_date = ? ORDER BY id");
        $adv->execute([$date]);
        $advances = $adv->fetchAll();
    } catch (PDOException $e) { /* table not present yet */ }

    // Market vendor settlement payouts (cash/bank out)
    $marketPayouts = [];
    try {
        $mp = $db->prepare("SELECT p.name_en AS party_name, ms.amount_paid AS amount, ms.payment_mode AS mode
                            FROM market_settlements ms JOIN parties p ON ms.vendor_id = p.id
                            WHERE ms.settle_date = ? AND ms.amount_paid > 0 ORDER BY ms.id");
        $mp->execute([$date]);
        $marketPayouts = $mp->fetchAll();
    } catch (PDOException $e) { /* table not present yet */ }

    $collSum   = listSplit($collections);
    $paySum    = listSplit($payouts);
    $expSum    = listSplit($expenses);
    $marketSum = listSplit($marketPayouts);
    $advSum    = listSplit($advances);

    $closeCash = round($openCash + $collSum['cash'] - $paySum['cash'] - $expSum['cash'] - $marketSum['cash'] - $advSum['cash'], 2);
    $closeBank = round($openBank + $collSum['bank'] - $paySum['bank'] - $expSum['bank'] - $marketSum['bank'] - $advSum['bank'], 2);

    // Memos (business context)
    $receivable = 0;
    try { $receivable = (float)$db->query("SELECT COALESCE(SUM(balance_due),0) v FROM vw_vendor_outstanding")->fetch()['v']; } catch (PDOException $e) {}
    $pb = $db->prepare("SELECT COALESCE(SUM(net_payable),0) v FROM purchase_bills WHERE is_cancelled=0 AND payment_status IN ('unpaid','partial')");
    $pb->execute();
    $payable = (float)$pb->fetch()['v'];
    $cm = $db->prepare("SELECT COALESCE(SUM(total_commission),0) v FROM purchase_bills WHERE bill_date=? AND is_cancelled=0");
    $cm->execute([$date]);
    $commission = (float)$cm->fetch()['v'];

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'date'    => $date,
        'opening' => ['cash' => $openCash, 'bank' => $openBank, 'total' => round($openCash + $openBank, 2), 'banks' => $banks, 'as_of' => $asOf],
        'collections' => $collections,
        'payouts'     => $payouts,
        'expenses'    => $expenses,
        'marketPayouts' => $marketPayouts,
        'advances'    => $advances,
        'totals'  => ['collections' => $collSum, 'payouts' => $paySum, 'expenses' => $expSum, 'market' => $marketSum, 'advances' => $advSum],
        'closing' => ['cash' => $closeCash, 'bank' => $closeBank, 'total' => round($closeCash + $closeBank, 2)],
        'memo'    => ['receivable' => round($receivable, 2), 'payable' => round($payable, 2), 'commission_today' => round($commission, 2)],
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

respondError('Invalid action', 400);
