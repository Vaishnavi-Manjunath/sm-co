<?php
// ============================================================
//  IDNUK SOFTWARE - Dashboard & Reports API
//  GET /api/reports?action=dashboard
//  GET /api/reports?action=pnl&from=&to=
//  GET /api/reports?action=aging
//  GET /api/reports?action=product-profit&from=&to=
//  GET /api/reports?action=expenses&from=&to=
//  GET /api/reports?action=tally-export&from=&to=
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'dashboard');
$db     = getDB();

// ---- GET: Dashboard - today + MTD + outstanding ----
if ($method === 'GET' && $action === 'dashboard') {
    // Defaults to the working/business date; pass ?date=Y-m-d to view any past day.
    $today = getParam('date', businessDate());
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$today)) $today = businessDate();
    $monthStart = date('Y-m-01', strtotime($today));

    // Today's purchase
    $purToday = $db->prepare("SELECT COUNT(*) AS bills, COALESCE(SUM(net_payable),0) AS paid,
                                     COALESCE(SUM(total_commission),0) AS commission
                              FROM purchase_bills WHERE bill_date=? AND is_cancelled=0");
    $purToday->execute([$today]);

    // Today's sales
    $salToday = $db->prepare("SELECT COUNT(*) AS bills, COALESCE(SUM(net_amount),0) AS amount
                              FROM sales_bills WHERE bill_date=? AND is_cancelled=0");
    $salToday->execute([$today]);

    // Today's expenses
    $expToday = $db->prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM daily_expenses WHERE expense_date=?");
    $expToday->execute([$today]);

    // Today's receipts
    $recToday = $db->prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM payments_received WHERE receipt_date=?");
    $recToday->execute([$today]);

    // MTD P&L
    $mtdPnl = $db->prepare("SELECT
        COALESCE(SUM(gross_sales),0) AS gross_sales,
        COALESCE(SUM(net_sales),0)   AS net_sales,
        COALESCE(SUM(gross_profit),0) AS gross_profit,
        COALESCE(SUM(total_commission_earned),0) AS commission
        FROM vw_daily_pnl WHERE txn_date BETWEEN ? AND ?");
    $mtdPnl->execute([$monthStart, $today]);

    // Outstanding summary
    $outstanding = $db->query("SELECT
        COUNT(*) AS total_bills,
        COUNT(DISTINCT party_id) AS total_vendors,
        COALESCE(SUM(balance_due),0) AS total_due,
        COALESCE(SUM(CASE WHEN days_overdue > 0 THEN balance_due ELSE 0 END),0) AS overdue_amt,
        COUNT(CASE WHEN days_overdue > 14 THEN 1 END) AS severely_overdue
        FROM vw_vendor_outstanding");

    // Top overdue vendors
    $topOverdue = $db->query("SELECT party_id, vendor_name, vendor_name_ta, phone1,
                                     SUM(balance_due) AS total_due,
                                     MAX(days_overdue) AS max_days_overdue
                              FROM vw_vendor_outstanding
                              WHERE days_overdue > 0
                              GROUP BY party_id, vendor_name, vendor_name_ta, phone1
                              ORDER BY total_due DESC LIMIT 5");

    // Recent bills (last 5)
    $recentBills = $db->query("SELECT sb.bill_no, sb.bill_date, sb.net_amount,
                                      sb.payment_status, p.name_en AS vendor_name
                               FROM sales_bills sb
                               JOIN parties p ON sb.party_id = p.id
                               WHERE sb.is_cancelled = 0
                               ORDER BY sb.id DESC LIMIT 5");

    // Today's rates count
    $ratesSet = $db->prepare("SELECT COUNT(*) AS count FROM daily_rates WHERE rate_date = ?");
    $ratesSet->execute([$today]);

    respond([
        'today' => [
            'purchase'  => $purToday->fetch(),
            'sales'     => $salToday->fetch(),
            'expenses'  => $expToday->fetch(),
            'receipts'  => $recToday->fetch(),
            'rates_set' => $ratesSet->fetch()['count'],
            'date'      => $today,
        ],
        'mtd'         => $mtdPnl->fetch(),
        'outstanding' => $outstanding->fetch(),
        'top_overdue' => $topOverdue->fetchAll(),
        'recent_bills'=> $recentBills->fetchAll(),
    ]);
}

// ---- GET: P&L Report ----
if ($method === 'GET' && $action === 'pnl') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    $group = getParam('group', 'daily'); // daily | weekly | monthly

    $groupBy = match($group) {
        'monthly' => "DATE_FORMAT(txn_date, '%Y-%m')",
        'weekly'  => "YEARWEEK(txn_date, 1)",
        default   => "txn_date"
    };

    $pnl = $db->prepare("SELECT $groupBy AS period,
        SUM(gross_sales) AS gross_sales, SUM(net_sales) AS net_sales,
        SUM(gross_profit) AS gross_profit, SUM(total_commission_earned) AS commission,
        SUM(sale_side_expenses) AS expenses
        FROM vw_daily_pnl WHERE txn_date BETWEEN ? AND ?
        GROUP BY $groupBy ORDER BY period");
    $pnl->execute([$from, $to]);
    $rows = $pnl->fetchAll();

    // Expenses in same period
    $exp = $db->prepare("SELECT COALESCE(SUM(amount),0) AS total FROM daily_expenses
                         WHERE expense_date BETWEEN ? AND ?");
    $exp->execute([$from, $to]);
    $totalExpenses = $exp->fetch()['total'];

    // Summary
    $summary = $db->prepare("SELECT
        COALESCE(SUM(gross_sales),0) AS gross_sales,
        COALESCE(SUM(net_sales),0) AS net_sales,
        COALESCE(SUM(gross_profit),0) AS gross_profit,
        COALESCE(SUM(total_commission_earned),0) AS commission
        FROM vw_daily_pnl WHERE txn_date BETWEEN ? AND ?");
    $summary->execute([$from, $to]);
    $summaryRow = $summary->fetch();
    $summaryRow['total_expenses'] = $totalExpenses;
    $summaryRow['net_profit'] = round($summaryRow['gross_profit'] - $totalExpenses, 2);

    http_response_code(200);
    echo json_encode(['success' => true, 'data' => $rows, 'summary' => $summaryRow], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Audit pack — financial-year P&L + balances + schedules for the auditor ----
if ($method === 'GET' && $action === 'audit-pack') {
    $from = getParam('from', date('Y-04-01'));
    $to   = getParam('to',   date('Y-m-d'));

    // Gross profit (trading margin + commission) — reuse the app's canonical P&L view; fall back to direct sums.
    $pnl = ['gross_sales' => 0, 'net_sales' => 0, 'gross_profit' => 0, 'commission' => 0];
    try {
        $s = $db->prepare("SELECT COALESCE(SUM(gross_sales),0) gross_sales, COALESCE(SUM(net_sales),0) net_sales,
                                  COALESCE(SUM(gross_profit),0) gross_profit, COALESCE(SUM(total_commission_earned),0) commission
                           FROM vw_daily_pnl WHERE txn_date BETWEEN ? AND ?");
        $s->execute([$from, $to]);
        $pnl = $s->fetch();
    } catch (PDOException $e) {
        $m = $db->prepare("SELECT COALESCE(SUM(si.margin_amount),0) margin,
                                  COALESCE(SUM(sb.net_amount),0) net_sales, COALESCE(SUM(sb.subtotal_amount),0) gross_sales
                           FROM sales_bills sb JOIN sales_items si ON si.bill_id = sb.id
                           WHERE sb.is_cancelled=0 AND sb.bill_date BETWEEN ? AND ?");
        $m->execute([$from, $to]); $mr = $m->fetch();
        $c = $db->prepare("SELECT COALESCE(SUM(total_commission),0) commission FROM purchase_bills WHERE is_cancelled=0 AND bill_date BETWEEN ? AND ?");
        $c->execute([$from, $to]); $cr = $c->fetch();
        $pnl = ['gross_sales' => (float)$mr['gross_sales'], 'net_sales' => (float)$mr['net_sales'],
                'gross_profit' => round((float)$mr['margin'] + (float)$cr['commission'], 2), 'commission' => (float)$cr['commission']];
    }

    // Operating expenses by category
    $ec = $db->prepare("SELECT COALESCE(ec.name_en,'Uncategorised') AS category, COALESCE(SUM(de.amount),0) AS amount, COUNT(*) AS entries
                        FROM daily_expenses de LEFT JOIN expense_categories ec ON de.category_id = ec.id
                        WHERE de.expense_date BETWEEN ? AND ? GROUP BY de.category_id ORDER BY amount DESC");
    $ec->execute([$from, $to]);
    $expByCat = $ec->fetchAll();
    $expTotal = array_sum(array_map(fn($r) => (float)$r['amount'], $expByCat));

    // Discounts / adjustments booked in the ledger
    $ld = $db->prepare("SELECT txn_type, COALESCE(SUM(credit),0) amt FROM ledger
                        WHERE txn_type IN ('DISCOUNT','ADJUSTMENT') AND txn_date BETWEEN ? AND ? GROUP BY txn_type");
    $ld->execute([$from, $to]);
    $disc = 0; $adj = 0;
    foreach ($ld->fetchAll() as $r) { if ($r['txn_type'] === 'DISCOUNT') $disc = (float)$r['amt']; else $adj = (float)$r['amt']; }

    // Turnover schedules
    $sv = $db->prepare("SELECT COUNT(*) bills, COALESCE(SUM(subtotal_amount),0) gross, COALESCE(SUM(net_amount),0) net
                        FROM sales_bills WHERE is_cancelled=0 AND bill_date BETWEEN ? AND ?");
    $sv->execute([$from, $to]); $salesAgg = $sv->fetch();
    $pv = $db->prepare("SELECT COUNT(*) bills, COALESCE(SUM(subtotal_amount),0) gross,
                               COALESCE(SUM(total_commission),0) commission, COALESCE(SUM(net_payable),0) net_payable
                        FROM purchase_bills WHERE is_cancelled=0 AND bill_date BETWEEN ? AND ?");
    $pv->execute([$from, $to]); $purAgg = $pv->fetch();
    $rc = $db->prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM payments_received WHERE receipt_date BETWEEN ? AND ?");
    $rc->execute([$from, $to]); $recAgg = $rc->fetch();
    $po = $db->prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM farmer_payouts WHERE pay_date BETWEEN ? AND ?");
    $po->execute([$from, $to]); $payAgg = $po->fetch();

    // Market vendor activity (optional tables)
    $market = ['purchases' => 0, 'paid' => 0, 'discount' => 0, 'netted' => 0];
    try {
        $mpv = $db->prepare("SELECT COALESCE(SUM(amount),0) v FROM market_purchases WHERE purchase_date BETWEEN ? AND ?");
        $mpv->execute([$from, $to]); $market['purchases'] = (float)$mpv->fetch()['v'];
        $msv = $db->prepare("SELECT COALESCE(SUM(amount_paid),0) paid, COALESCE(SUM(discount_amt),0) disc, COALESCE(SUM(sales_netted),0) netted
                             FROM market_settlements WHERE settle_date BETWEEN ? AND ?");
        $msv->execute([$from, $to]); $mr = $msv->fetch();
        $market['paid'] = (float)$mr['paid']; $market['discount'] = (float)$mr['disc']; $market['netted'] = (float)$mr['netted'];
    } catch (PDOException $e) { /* market module not in use */ }

    // Closing balances as of the period end
    $recv = $db->prepare("SELECT COALESCE(SUM(balance_due),0) v FROM sales_bills WHERE is_cancelled=0 AND bill_date <= ?");
    $recv->execute([$to]); $receivable = (float)$recv->fetch()['v'];
    $payf = $db->prepare("SELECT COALESCE(SUM(net_payable),0) v FROM purchase_bills WHERE is_cancelled=0 AND payment_status IN ('unpaid','partial') AND bill_date <= ?");
    $payf->execute([$to]); $payableFarmer = (float)$payf->fetch()['v'];
    $payableMarket = 0;
    try {
        $pmv = $db->prepare("SELECT COALESCE(SUM(amount),0) v FROM market_purchases WHERE is_settled=0 AND purchase_date <= ?");
        $pmv->execute([$to]); $payableMarket = (float)$pmv->fetch()['v'];
    } catch (PDOException $e) {}

    $netProfit = round((float)$pnl['gross_profit'] - $expTotal - $disc, 2);

    respond([
        'period' => ['from' => $from, 'to' => $to],
        'pnl' => [
            'gross_profit'   => round((float)$pnl['gross_profit'], 2),   // trading margin + commission
            'commission'     => round((float)$pnl['commission'], 2),
            'gross_sales'    => round((float)$pnl['gross_sales'], 2),
            'expenses_total' => round($expTotal, 2),
            'expenses_by_cat'=> $expByCat,
            'discounts'      => round($disc, 2),
            'adjustments'    => round($adj, 2),
            'net_profit'     => $netProfit,
        ],
        'turnover' => [
            'sales'     => $salesAgg,
            'purchases' => $purAgg,
            'receipts'  => $recAgg,
            'payouts'   => $payAgg,
            'market'    => $market,
        ],
        'balances' => [
            'receivable'      => round($receivable, 2),
            'payable_farmer'  => round($payableFarmer, 2),
            'payable_market'  => round($payableMarket, 2),
        ],
    ]);
}

// ---- GET: Product profit analysis ----
if ($method === 'GET' && $action === 'product-profit') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));

    $stmt = $db->prepare("SELECT * FROM vw_product_profit
                          WHERE month BETWEEN DATE_FORMAT(?,'%Y-%m') AND DATE_FORMAT(?,'%Y-%m')
                          ORDER BY total_margin DESC");
    $stmt->execute([$from, $to]);
    respondList($stmt->fetchAll());
}

// ---- GET: Expense report ----
if ($method === 'GET' && $action === 'expenses') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));

    $stmt = $db->prepare("
        SELECT ec.name_en AS category, ec.name_ta AS category_ta,
               COUNT(*) AS entries, SUM(de.amount) AS total
        FROM daily_expenses de
        JOIN expense_categories ec ON de.category_id = ec.id
        WHERE de.expense_date BETWEEN ? AND ?
        GROUP BY ec.id ORDER BY total DESC
    ");
    $stmt->execute([$from, $to]);
    $summary = $stmt->fetchAll();

    $detail = $db->prepare("
        SELECT de.*, ec.name_en AS category, ec.name_ta AS category_ta,
               p.name_en AS party_name, u.username AS created_by_name
        FROM daily_expenses de
        JOIN expense_categories ec ON de.category_id = ec.id
        LEFT JOIN parties p ON de.party_id = p.id
        LEFT JOIN users u ON de.created_by = u.id
        WHERE de.expense_date BETWEEN ? AND ?
        ORDER BY de.expense_date DESC, de.id DESC
    ");
    $detail->execute([$from, $to]);

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'summary' => $summary,
        'detail'  => $detail->fetchAll(),
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- POST: Add expense ----
if ($method === 'POST' && $action === 'add-expense') {
    $b = getBody();
    if (empty($b['category_id']))  respondError('Category required');
    if (empty($b['amount']))       respondError('Amount required');
    if (empty($b['description']))  respondError('Description required');

    $expDate = $b['expense_date'] ?? businessDate();
    assertDateUnlocked($expDate);

    $db->prepare("INSERT INTO daily_expenses
        (expense_date, category_id, party_id, description, amount, payment_mode, notes, created_by)
        VALUES (?,?,?,?,?,?,?,?)")
       ->execute([
           $expDate,
           $b['category_id'],
           $b['party_id']    ?? null,
           $b['description'],
           $b['amount'],
           $b['payment_mode'] ?? 'cash',
           $b['notes']        ?? null,
           $user['id']
       ]);

    $expId = $db->lastInsertId();
    auditLog('CREATE', 'expense', $expId, $b['description'], ['amount' => (float)$b['amount'], 'mode' => $b['payment_mode'] ?? 'cash']);
    respond(['id' => $expId, 'action' => 'created']);
}

// ---- GET: Tally XML export ----
if ($method === 'GET' && $action === 'tally-export') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));

    // Fetch sales for Tally
    $sales = $db->prepare("SELECT sb.bill_no, sb.bill_date, sb.net_amount,
                                  p.name_en AS party_name
                           FROM sales_bills sb
                           JOIN parties p ON sb.party_id = p.id
                           WHERE sb.bill_date BETWEEN ? AND ? AND sb.is_cancelled=0");
    $sales->execute([$from, $to]);
    $salesRows = $sales->fetchAll();

    // Build Tally XML
    $xml  = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
    $xml .= '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY>';
    $xml .= '<IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>';
    $xml .= '<REQUESTDATA>';

    foreach ($salesRows as $s) {
        $xml .= '<TALLYMESSAGE xmlns:UDF="TallyUDF">';
        $xml .= '<VOUCHER VCHTYPE="Sales" ACTION="Create">';
        $xml .= '<DATE>' . str_replace('-', '', $s['bill_date']) . '</DATE>';
        $xml .= '<VOUCHERNUMBER>' . htmlspecialchars($s['bill_no']) . '</VOUCHERNUMBER>';
        $xml .= '<PARTYLEDGERNAME>' . htmlspecialchars($s['party_name']) . '</PARTYLEDGERNAME>';
        $xml .= '<ALLLEDGERENTRIES.LIST>';
        $xml .= '<LEDGERNAME>' . htmlspecialchars($s['party_name']) . '</LEDGERNAME>';
        $xml .= '<AMOUNT>-' . number_format($s['net_amount'], 2, '.', '') . '</AMOUNT>';
        $xml .= '</ALLLEDGERENTRIES.LIST>';
        $xml .= '<ALLLEDGERENTRIES.LIST>';
        $xml .= '<LEDGERNAME>Sales Account</LEDGERNAME>';
        $xml .= '<AMOUNT>' . number_format($s['net_amount'], 2, '.', '') . '</AMOUNT>';
        $xml .= '</ALLLEDGERENTRIES.LIST>';
        $xml .= '</VOUCHER></TALLYMESSAGE>';
    }

    $xml .= '</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>';

    // Log the export (best-effort; never block the download if the table is absent)
    try {
        $db->prepare("INSERT INTO tally_exports
            (export_date, from_date, to_date, export_type, record_count, file_name, status, exported_by)
            VALUES (NOW(),?,?,'sales',?,?,?,?)")
           ->execute([$from, $to, count($salesRows),
                      "tally_sales_{$from}_{$to}.xml", 'success', $user['id']]);
    } catch (Exception $e) { /* logging is optional */ }

    header('Content-Type: application/xml');
    header("Content-Disposition: attachment; filename=\"tally_sales_{$from}_{$to}.xml\"");
    echo $xml;
    exit();
}

// ---- GET: Payments list by date ----
if ($method === 'GET' && $action === 'payments-daily') {
    $from    = getParam('from', date('Y-m-d'));
    $to      = getParam('to',   date('Y-m-d'));
    $stmt = $db->prepare("
        SELECT pr.*, p.name_en AS party_name, p.name_ta AS party_name_ta, p.phone1
        FROM payments_received pr
        JOIN parties p ON pr.party_id = p.id
        WHERE pr.receipt_date BETWEEN ? AND ?
        ORDER BY pr.receipt_date DESC, pr.id DESC
    ");
    $stmt->execute([$from, $to]);
    respondList($stmt->fetchAll());
}

// ---- GET: Today's collections (money received) + farmer payouts ----
if ($method === 'GET' && $action === 'collections') {
    $from = getParam('from', date('Y-m-d'));
    $to   = getParam('to',   date('Y-m-d'));

    $stmt = $db->prepare("
        SELECT pr.id, pr.receipt_no, pr.receipt_date, pr.amount,
               COALESCE(pr.discount_amt, 0) AS discount_amt, pr.payment_mode, pr.payment_ref, pr.bank_name,
               p.name_en AS party_name, p.name_ta AS party_name_ta, p.city
        FROM payments_received pr
        JOIN parties p ON pr.party_id = p.id
        WHERE pr.receipt_date BETWEEN ? AND ?
        ORDER BY pr.receipt_date DESC, pr.id DESC");
    $stmt->execute([$from, $to]);
    $rows = $stmt->fetchAll();

    // Summary by payment mode (+ total discount given on these receipts)
    $byMode = [];
    $total = 0; $discTotal = 0;
    foreach ($rows as $r) {
        $m = $r['payment_mode'] ?: 'cash';
        $byMode[$m] = ($byMode[$m] ?? 0) + (float)$r['amount'];
        $total += (float)$r['amount'];
        $discTotal += (float)$r['discount_amt'];
    }
    http_response_code(200);
    echo json_encode(['success' => true, 'data' => $rows,
        'summary' => ['total' => $total, 'discount_total' => $discTotal, 'by_mode' => $byMode, 'count' => count($rows)]], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Vendor sales grouped by product ----
if ($method === 'GET' && $action === 'sales-by-product') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));

    $stmt = $db->prepare("
        SELECT pr.id AS product_id, pr.name_en, pr.name_ta,
               COALESCE(SUM(si.no_of_bags),0)    AS bags,
               COALESCE(SUM(si.vendor_weight),0) AS weight,
               COALESCE(SUM(si.gross_amount),0)  AS gross,
               COALESCE(SUM(si.net_amount),0)    AS net,
               COALESCE(SUM(si.margin_amount),0) AS margin,
               COUNT(DISTINCT si.bill_id)        AS bills
        FROM sales_items si
        JOIN sales_bills sb ON si.bill_id = sb.id
        JOIN products pr     ON si.product_id = pr.id
        WHERE sb.is_cancelled = 0 AND sb.bill_date BETWEEN ? AND ?
        GROUP BY pr.id, pr.name_en, pr.name_ta
        ORDER BY net DESC");
    $stmt->execute([$from, $to]);
    respondList($stmt->fetchAll());
}

// ---- GET: Tally sheet — purchases vs sales reconciliation (profit/loss) ----
if ($method === 'GET' && $action === 'tally-sheet') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));

    $pur = $db->prepare("SELECT COUNT(*) AS bills,
               COALESCE(SUM(subtotal_weight),0) AS weight,
               COALESCE(SUM(subtotal_amount),0) AS gross,
               COALESCE(SUM(net_payable),0)     AS paid,
               COALESCE(SUM(total_commission),0) AS commission
        FROM purchase_bills WHERE is_cancelled=0 AND bill_date BETWEEN ? AND ?");
    $pur->execute([$from, $to]);
    $purchase = $pur->fetch();

    $purBags = $db->prepare("SELECT COALESCE(SUM(pi.no_of_bags),0) AS bags
        FROM purchase_items pi JOIN purchase_bills pb ON pi.bill_id=pb.id
        WHERE pb.is_cancelled=0 AND pb.bill_date BETWEEN ? AND ?");
    $purBags->execute([$from, $to]);
    $purchase['bags'] = $purBags->fetch()['bags'];

    $sal = $db->prepare("SELECT COUNT(*) AS bills,
               COALESCE(SUM(subtotal_weight),0) AS weight,
               COALESCE(SUM(subtotal_amount),0) AS gross,
               COALESCE(SUM(net_amount),0)      AS net
        FROM sales_bills WHERE is_cancelled=0 AND bill_date BETWEEN ? AND ?");
    $sal->execute([$from, $to]);
    $sales = $sal->fetch();

    $salExtra = $db->prepare("SELECT COALESCE(SUM(si.no_of_bags),0) AS bags, COALESCE(SUM(si.margin_amount),0) AS margin
        FROM sales_items si JOIN sales_bills sb ON si.bill_id=sb.id
        WHERE sb.is_cancelled=0 AND sb.bill_date BETWEEN ? AND ?");
    $salExtra->execute([$from, $to]);
    $se = $salExtra->fetch();
    $sales['bags']   = $se['bags'];
    $sales['margin'] = $se['margin'];

    // Supplier (own-account) purchases — folded into the SAME tally so the day
    // reconciles in ONE place: goods bought on our own capital from out-of-town
    // suppliers and distributed to market vendors / order vendors, alongside the
    // commission (farmer) purchases above. 'goods' = goods value; 'cost' = landed
    // cost we owe (goods + freight + market charges + middleman + other).
    $supplier = ['bills' => 0, 'bags' => 0, 'weight' => 0, 'goods' => 0, 'cost' => 0];
    try {
        $sp = $db->prepare("SELECT COUNT(*) AS bills,
                   COALESCE(SUM(subtotal_bags),0)   AS bags,
                   COALESCE(SUM(subtotal_weight),0) AS weight,
                   COALESCE(SUM(goods_amount),0)    AS goods,
                   COALESCE(SUM(total_cost),0)      AS cost
            FROM supplier_purchase_bills WHERE is_cancelled=0 AND bill_date BETWEEN ? AND ?");
        $sp->execute([$from, $to]);
        $sr = $sp->fetch();
        $supplier = ['bills' => (int)$sr['bills'], 'bags' => (int)$sr['bags'],
                     'weight' => round((float)$sr['weight'], 2), 'goods' => round((float)$sr['goods'], 2),
                     'cost' => round((float)$sr['cost'], 2)];
    } catch (PDOException $e) { /* supplier tables not present yet */ }

    // Market purchases — goods bought from local market vendors, folded into the
    // SAME tally as another purchase entry so the day reconciles in one place.
    // These are held PENDING (no cash out / no ledger) until weekly settlement,
    // so they're shown informationally and NOT added to the cash-out below.
    $market = ['bills' => 0, 'bags' => 0, 'weight' => 0, 'cost' => 0];
    try {
        $mk = $db->prepare("SELECT COUNT(*) AS bills,
                   COALESCE(SUM(subtotal_bags),0)   AS bags,
                   COALESCE(SUM(subtotal_weight),0) AS weight,
                   COALESCE(SUM(amount),0)          AS cost
            FROM market_purchases WHERE purchase_date BETWEEN ? AND ?");
        $mk->execute([$from, $to]);
        $mr = $mk->fetch();
        $market = ['bills' => (int)$mr['bills'], 'bags' => (int)$mr['bags'],
                   'weight' => round((float)$mr['weight'], 2), 'cost' => round((float)$mr['cost'], 2)];
    } catch (PDOException $e) { /* market tables not present yet */ }

    // Daily series (sales net vs purchase paid) for the chart
    $series = $db->prepare("
        SELECT d AS day,
          (SELECT COALESCE(SUM(net_payable),0) FROM purchase_bills WHERE is_cancelled=0 AND bill_date=d) AS purchase,
          (SELECT COALESCE(SUM(net_amount),0)  FROM sales_bills    WHERE is_cancelled=0 AND bill_date=d) AS sales
        FROM (SELECT DISTINCT bill_date AS d FROM purchase_bills WHERE bill_date BETWEEN ? AND ?
              UNION SELECT DISTINCT bill_date FROM sales_bills WHERE bill_date BETWEEN ? AND ?) days
        ORDER BY day");
    $series->execute([$from, $to, $from, $to]);

    // Discounts given to vendors in the period (reduce profit)
    $disc = $db->prepare("SELECT COALESCE(SUM(credit),0) AS amt FROM ledger
                          WHERE txn_type='DISCOUNT' AND txn_date BETWEEN ? AND ?");
    $disc->execute([$from, $to]);
    $discounts = round((float)$disc->fetch()['amt'], 2);

    // Cash reality on the sales billed in this period: how much is collected vs still owed
    $coll = $db->prepare("SELECT COALESCE(SUM(net_amount),0) AS billed,
                                 COALESCE(SUM(paid_amount),0) AS collected,
                                 COALESCE(SUM(balance_due),0) AS outstanding
        FROM sales_bills WHERE is_cancelled=0 AND bill_date BETWEEN ? AND ?");
    $coll->execute([$from, $to]);
    $cash = $coll->fetch();

    // Pending sales — items staged (Bill-by-Product) in this period but not yet turned
    // into a vendor sales bill. The "Sales" totals above count only billed bills, so
    // staged-but-unbilled goods make purchases look unmatched by sales. Surfacing them
    // (valued qty × rate) lets the sheet reconcile BEFORE the final bills are raised.
    $pendBags = 0; $pendWeight = 0; $pendTotal = 0; $pendCount = 0;
    try {
        $ps = $db->prepare("SELECT ss.no_of_bags, ss.weight, ss.rate,
                                   COALESCE(pr.unit_type, 'KG') AS unit_type
                            FROM sales_staged_items ss
                            LEFT JOIN products pr ON ss.product_id = pr.id
                            WHERE ss.is_billed = 0 AND ss.entry_date BETWEEN ? AND ?");
        $ps->execute([$from, $to]);
        foreach ($ps->fetchAll() as $r) {
            $qty = strtoupper($r['unit_type']) === 'BAG' ? (float)$r['no_of_bags'] : (float)$r['weight'];
            $pendTotal  += $qty * (float)$r['rate'];
            $pendBags   += (float)$r['no_of_bags'];
            $pendWeight += (float)$r['weight'];
            $pendCount++;
        }
    } catch (PDOException $e) { /* table not present yet */ }

    // Yard allocations still pending carry no rate, so they can't be valued — just count them.
    $pendYard = 0;
    try {
        $py = $db->prepare("SELECT COUNT(*) FROM yard_allocations WHERE is_billed = 0 AND entry_date BETWEEN ? AND ?");
        $py->execute([$from, $to]);
        $pendYard = (int)$py->fetchColumn();
    } catch (PDOException $e) { /* table not present yet */ }

    // Cash-out covers BOTH farmer payouts and supplier landed cost, so "sold minus paid"
    // reflects the whole day's outflow — the single reconciliation the user is after.
    $soldMinusPaid = round((float)$sales['net'] - ((float)$purchase['paid'] + (float)$supplier['cost']), 2);
    $margin = round((float)$sales['margin'], 2);
    $commission = round((float)$purchase['commission'], 2);
    http_response_code(200);
    echo json_encode(['success' => true,
        'purchase' => $purchase, 'sales' => $sales, 'supplier' => $supplier, 'market' => $market,
        'pending' => [
            'bags'       => (int)$pendBags,
            'weight'     => round($pendWeight, 2),
            'amount'     => round($pendTotal, 2),
            'count'      => $pendCount,
            'yard_count' => $pendYard,
        ],
        'profit' => [
            'sold_minus_paid' => $soldMinusPaid,
            'commission'      => $commission,
            'margin'          => $margin,
            'gross'           => round($margin + $commission, 2),
            'discounts'       => $discounts,
            'net_profit'      => round($margin + $commission - $discounts, 2),
        ],
        'cash' => [
            'billed'      => round((float)$cash['billed'], 2),
            'collected'   => round((float)$cash['collected'], 2),
            'outstanding' => round((float)$cash['outstanding'], 2),
        ],
        'series' => $series->fetchAll()], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Product P&L over a date range (purchased vs sold) ----
if ($method === 'GET' && $action === 'product-pnl') {
    $productId = getParam('product_id');
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    if (!$productId) respondError('product_id required');

    $pur = $db->prepare("SELECT COALESCE(SUM(pi.no_of_bags),0) AS bags,
               COALESCE(SUM(pi.billed_weight),0) AS weight, COALESCE(SUM(pi.gross_amount),0) AS amount
        FROM purchase_items pi JOIN purchase_bills pb ON pi.bill_id=pb.id
        WHERE pi.product_id=? AND pb.is_cancelled=0 AND pb.bill_date BETWEEN ? AND ?");
    $pur->execute([$productId, $from, $to]);

    $sal = $db->prepare("SELECT COALESCE(SUM(si.no_of_bags),0) AS bags,
               COALESCE(SUM(si.vendor_weight),0) AS weight, COALESCE(SUM(si.gross_amount),0) AS amount,
               COALESCE(SUM(si.margin_amount),0) AS margin
        FROM sales_items si JOIN sales_bills sb ON si.bill_id=sb.id
        WHERE si.product_id=? AND sb.is_cancelled=0 AND sb.bill_date BETWEEN ? AND ?");
    $sal->execute([$productId, $from, $to]);

    $purchase = $pur->fetch(); $sales = $sal->fetch();
    http_response_code(200);
    echo json_encode(['success' => true, 'purchase' => $purchase, 'sales' => $sales,
        'profit' => [
            'sold_minus_paid' => round((float)$sales['amount'] - (float)$purchase['amount'], 2),
            'margin'          => round((float)$sales['margin'], 2),
        ]], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Vendor P&L over a date range (their sales + margin earned) ----
if ($method === 'GET' && $action === 'vendor-pnl') {
    $partyId = getParam('party_id');
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    if (!$partyId) respondError('party_id required');

    $tot = $db->prepare("SELECT COUNT(DISTINCT sb.id) AS bills,
               COALESCE(SUM(si.vendor_weight),0) AS weight,
               COALESCE(SUM(si.gross_amount),0)  AS gross,
               COALESCE(SUM(si.net_amount),0)    AS net,
               COALESCE(SUM(si.margin_amount),0) AS margin
        FROM sales_items si JOIN sales_bills sb ON si.bill_id=sb.id
        WHERE sb.party_id=? AND sb.is_cancelled=0 AND sb.bill_date BETWEEN ? AND ?");
    $tot->execute([$partyId, $from, $to]);

    $byProduct = $db->prepare("SELECT pr.name_en, pr.name_ta,
               COALESCE(SUM(si.no_of_bags),0) AS bags, COALESCE(SUM(si.vendor_weight),0) AS weight,
               COALESCE(SUM(si.net_amount),0) AS net, COALESCE(SUM(si.margin_amount),0) AS margin
        FROM sales_items si JOIN sales_bills sb ON si.bill_id=sb.id
        JOIN products pr ON si.product_id=pr.id
        WHERE sb.party_id=? AND sb.is_cancelled=0 AND sb.bill_date BETWEEN ? AND ?
        GROUP BY pr.id, pr.name_en, pr.name_ta ORDER BY net DESC");
    $byProduct->execute([$partyId, $from, $to]);

    // Discounts given to this vendor in range (reduce their net margin)
    $disc = $db->prepare("SELECT COALESCE(SUM(credit),0) AS amt FROM ledger
                          WHERE txn_type='DISCOUNT' AND party_id=? AND txn_date BETWEEN ? AND ?");
    $disc->execute([$partyId, $from, $to]);
    $totals = $tot->fetch();
    $totals['discounts'] = round((float)$disc->fetch()['amt'], 2);
    $totals['net_margin'] = round((float)$totals['margin'] - (float)$totals['discounts'], 2);

    http_response_code(200);
    echo json_encode(['success' => true, 'totals' => $totals, 'by_product' => $byProduct->fetchAll()], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Product-wise purchase vs sales (tally breakdown + profit) ----
if ($method === 'GET' && $action === 'tally-product') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));

    $purStmt = $db->prepare("SELECT pi.product_id, pr.name_en, pr.name_ta,
               COALESCE(SUM(pi.no_of_bags),0) AS bags, COALESCE(SUM(pi.billed_weight),0) AS weight, COALESCE(SUM(pi.gross_amount),0) AS amount
        FROM purchase_items pi JOIN purchase_bills pb ON pi.bill_id=pb.id JOIN products pr ON pi.product_id=pr.id
        WHERE pb.is_cancelled=0 AND pb.bill_date BETWEEN ? AND ? GROUP BY pi.product_id, pr.name_en, pr.name_ta");
    $purStmt->execute([$from, $to]);

    $salStmt = $db->prepare("SELECT si.product_id, pr.name_en, pr.name_ta,
               COALESCE(SUM(si.no_of_bags),0) AS bags, COALESCE(SUM(si.vendor_weight),0) AS weight, COALESCE(SUM(si.gross_amount),0) AS amount
        FROM sales_items si JOIN sales_bills sb ON si.bill_id=sb.id JOIN products pr ON si.product_id=pr.id
        WHERE sb.is_cancelled=0 AND sb.bill_date BETWEEN ? AND ? GROUP BY si.product_id, pr.name_en, pr.name_ta");
    $salStmt->execute([$from, $to]);

    $map = [];
    foreach ($purStmt->fetchAll() as $r) {
        $map[$r['product_id']] = ['product_id' => $r['product_id'], 'name_en' => $r['name_en'], 'name_ta' => $r['name_ta'],
            'pur_bags' => (float)$r['bags'], 'pur_weight' => (float)$r['weight'], 'pur_amount' => (float)$r['amount'],
            // Per-source split so the breakdown can show Farmer vs Supplier vs Market separately.
            'pf_bags' => (float)$r['bags'], 'pf_weight' => (float)$r['weight'], 'pf_amount' => (float)$r['amount'],
            'sal_bags' => 0, 'sal_weight' => 0, 'sal_amount' => 0];
    }
    // Fold supplier (own-account) purchases into the SAME per-product "Purchased" figures,
    // so the breakdown reconciles all goods bought against all goods sold in one place.
    // The bill-level charges (freight / market / middleman / other) are LANDED COST, so we
    // spread them across the bill's products pro-rata by goods value — that way each
    // product's "Purchased Amount" is its true cost, and the column sums to total_cost.
    try {
        $supItems = $db->prepare("SELECT spi.product_id, pr.name_en, pr.name_ta,
                   COALESCE(SUM(spi.no_of_bags),0) AS bags, COALESCE(SUM(spi.weight),0) AS weight,
                   COALESCE(SUM(spi.amount + CASE WHEN spb.goods_amount > 0
                        THEN (spb.freight + spb.market_charges + spb.middleman_comm + spb.other_charges) * spi.amount / spb.goods_amount
                        ELSE 0 END), 0) AS amount
            FROM supplier_purchase_items spi JOIN supplier_purchase_bills spb ON spi.bill_id=spb.id JOIN products pr ON spi.product_id=pr.id
            WHERE spb.is_cancelled=0 AND spb.bill_date BETWEEN ? AND ? GROUP BY spi.product_id, pr.name_en, pr.name_ta");
        $supItems->execute([$from, $to]);
        foreach ($supItems->fetchAll() as $r) {
            if (!isset($map[$r['product_id']])) $map[$r['product_id']] = ['product_id' => $r['product_id'], 'name_en' => $r['name_en'], 'name_ta' => $r['name_ta'],
                'pur_bags' => 0, 'pur_weight' => 0, 'pur_amount' => 0, 'sal_bags' => 0, 'sal_weight' => 0, 'sal_amount' => 0];
            $map[$r['product_id']]['pur_bags']   += (float)$r['bags'];
            $map[$r['product_id']]['pur_weight'] += (float)$r['weight'];
            $map[$r['product_id']]['pur_amount'] += (float)$r['amount'];
            $map[$r['product_id']]['ps_bags']   = ($map[$r['product_id']]['ps_bags']   ?? 0) + (float)$r['bags'];
            $map[$r['product_id']]['ps_weight'] = ($map[$r['product_id']]['ps_weight'] ?? 0) + (float)$r['weight'];
            $map[$r['product_id']]['ps_amount'] = ($map[$r['product_id']]['ps_amount'] ?? 0) + (float)$r['amount'];
        }
    } catch (PDOException $e) { /* supplier tables not present yet */ }
    // Fold market-vendor purchases (local buys, no extra charges) into the same
    // per-product "Purchased" figures — so all goods bought reconcile against all sold.
    try {
        $mktItems = $db->prepare("SELECT mpi.product_id, pr.name_en, pr.name_ta,
                   COALESCE(SUM(mpi.no_of_bags),0) AS bags, COALESCE(SUM(mpi.weight),0) AS weight,
                   COALESCE(SUM(mpi.amount),0) AS amount
            FROM market_purchase_items mpi JOIN market_purchases mp ON mpi.purchase_id=mp.id JOIN products pr ON mpi.product_id=pr.id
            WHERE mp.purchase_date BETWEEN ? AND ? GROUP BY mpi.product_id, pr.name_en, pr.name_ta");
        $mktItems->execute([$from, $to]);
        foreach ($mktItems->fetchAll() as $r) {
            if (!isset($map[$r['product_id']])) $map[$r['product_id']] = ['product_id' => $r['product_id'], 'name_en' => $r['name_en'], 'name_ta' => $r['name_ta'],
                'pur_bags' => 0, 'pur_weight' => 0, 'pur_amount' => 0, 'sal_bags' => 0, 'sal_weight' => 0, 'sal_amount' => 0];
            $map[$r['product_id']]['pur_bags']   += (float)$r['bags'];
            $map[$r['product_id']]['pur_weight'] += (float)$r['weight'];
            $map[$r['product_id']]['pur_amount'] += (float)$r['amount'];
            $map[$r['product_id']]['pm_bags']   = ($map[$r['product_id']]['pm_bags']   ?? 0) + (float)$r['bags'];
            $map[$r['product_id']]['pm_weight'] = ($map[$r['product_id']]['pm_weight'] ?? 0) + (float)$r['weight'];
            $map[$r['product_id']]['pm_amount'] = ($map[$r['product_id']]['pm_amount'] ?? 0) + (float)$r['amount'];
        }
    } catch (PDOException $e) { /* market tables not present yet */ }
    foreach ($salStmt->fetchAll() as $r) {
        if (!isset($map[$r['product_id']])) $map[$r['product_id']] = ['product_id' => $r['product_id'], 'name_en' => $r['name_en'], 'name_ta' => $r['name_ta'],
            'pur_bags' => 0, 'pur_weight' => 0, 'pur_amount' => 0, 'sal_bags' => 0, 'sal_weight' => 0, 'sal_amount' => 0];
        $map[$r['product_id']]['sal_bags']   = (float)$r['bags'];
        $map[$r['product_id']]['sal_weight'] = (float)$r['weight'];
        $map[$r['product_id']]['sal_amount'] = (float)$r['amount'];
    }
    // Pending (staged, not-yet-billed) sales per product — shown distinctly in the
    // breakdown so it's clear those goods are sold-but-not-invoiced, and the row
    // reconciles against purchases before the vendor bills are raised.
    try {
        $pendItems = $db->prepare("SELECT ss.product_id, pr.name_en, pr.name_ta,
                   COALESCE(SUM(ss.no_of_bags),0) AS bags, COALESCE(SUM(ss.weight),0) AS weight,
                   COALESCE(SUM((CASE WHEN UPPER(COALESCE(pr.unit_type,'KG'))='BAG' THEN ss.no_of_bags ELSE ss.weight END) * ss.rate),0) AS amount
            FROM sales_staged_items ss JOIN products pr ON ss.product_id = pr.id
            WHERE ss.is_billed = 0 AND ss.entry_date BETWEEN ? AND ? GROUP BY ss.product_id, pr.name_en, pr.name_ta");
        $pendItems->execute([$from, $to]);
        foreach ($pendItems->fetchAll() as $r) {
            if (!isset($map[$r['product_id']])) $map[$r['product_id']] = ['product_id' => $r['product_id'], 'name_en' => $r['name_en'], 'name_ta' => $r['name_ta'],
                'pur_bags' => 0, 'pur_weight' => 0, 'pur_amount' => 0, 'sal_bags' => 0, 'sal_weight' => 0, 'sal_amount' => 0];
            $map[$r['product_id']]['pend_bags']   = (float)$r['bags'];
            $map[$r['product_id']]['pend_weight'] = (float)$r['weight'];
            $map[$r['product_id']]['pend_amount'] = (float)$r['amount'];
        }
    } catch (PDOException $e) { /* staged table not present yet */ }

    $rows = array_values($map);
    foreach ($rows as &$x) {
        $x['pend_bags']   = round($x['pend_bags']   ?? 0, 2);
        $x['pend_weight'] = round($x['pend_weight'] ?? 0, 2);
        $x['pend_amount'] = round($x['pend_amount'] ?? 0, 2);
        foreach (['pf', 'ps', 'pm'] as $src) {
            $x["{$src}_bags"]   = round($x["{$src}_bags"]   ?? 0, 2);
            $x["{$src}_weight"] = round($x["{$src}_weight"] ?? 0, 2);
            $x["{$src}_amount"] = round($x["{$src}_amount"] ?? 0, 2);
        }
        $x['weight_profit'] = round($x['sal_weight'] - $x['pur_weight'], 2);
        $x['amount_profit'] = round($x['sal_amount'] - $x['pur_amount'], 2);
    }
    unset($x);
    usort($rows, fn($a, $b) => $b['amount_profit'] <=> $a['amount_profit']);
    respondList($rows);
}

// ---- GET: Sales totals grouped by vendor (Vendor P&L 'All') ----
if ($method === 'GET' && $action === 'sales-by-vendor') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    $stmt = $db->prepare("SELECT sb.party_id, p.name_en, p.name_ta, p.city,
               COUNT(DISTINCT sb.id) AS bills,
               COALESCE(SUM(si.vendor_weight),0) AS weight,
               COALESCE(SUM(si.net_amount),0) AS net,
               COALESCE(SUM(si.margin_amount),0) AS margin
        FROM sales_items si JOIN sales_bills sb ON si.bill_id=sb.id JOIN parties p ON sb.party_id=p.id
        WHERE sb.is_cancelled=0 AND sb.bill_date BETWEEN ? AND ? GROUP BY sb.party_id, p.name_en, p.name_ta, p.city
        ORDER BY net DESC");
    $stmt->execute([$from, $to]);
    respondList($stmt->fetchAll());
}

// ---- GET: One vendor's sales per day ----
if ($method === 'GET' && $action === 'vendor-daily') {
    $partyId = getParam('party_id');
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    if (!$partyId) respondError('party_id required');
    $stmt = $db->prepare("SELECT sb.bill_date,
               COUNT(DISTINCT sb.id) AS bills,
               COALESCE(SUM(si.no_of_bags),0) AS bags,
               COALESCE(SUM(si.vendor_weight),0) AS weight,
               COALESCE(SUM(si.net_amount),0) AS net,
               COALESCE(SUM(si.margin_amount),0) AS margin
        FROM sales_items si JOIN sales_bills sb ON si.bill_id=sb.id
        WHERE sb.party_id=? AND sb.is_cancelled=0 AND sb.bill_date BETWEEN ? AND ?
        GROUP BY sb.bill_date ORDER BY sb.bill_date DESC");
    $stmt->execute([$partyId, $from, $to]);
    respondList($stmt->fetchAll());
}

// ---- GET: Farmer/supplier payouts list ----
if ($method === 'GET' && $action === 'payouts-list') {
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    $stmt = $db->prepare("SELECT id, pay_date, party_name, amount, mode, bank_name, payment_ref, purchase_bill_id
        FROM farmer_payouts WHERE pay_date BETWEEN ? AND ? ORDER BY pay_date DESC, id DESC");
    $stmt->execute([$from, $to]);
    respondList($stmt->fetchAll());
}

// ---- GET: Party ledger / statement (transactions + running balance) ----
if ($method === 'GET' && $action === 'party-ledger') {
    $partyId = getParam('party_id');
    $from = getParam('from', date('Y-m-01'));
    $to   = getParam('to',   date('Y-m-d'));
    if (!$partyId) respondError('party_id required');

    $party = $db->prepare("SELECT id, name_en, name_ta, phone1, city, opening_balance, opening_bal_type FROM parties WHERE id = ?");
    $party->execute([$partyId]);
    $partyRow = $party->fetch();
    if (!$partyRow) respondError('Party not found', 404);

    // Opening balance = the party's imported/initial opening (dr = owes us) + any ledger
    // movements before the from-date. (Imported vendor openings live on parties.opening_balance.)
    // parties.opening_balance is the single source of the opening; exclude any
    // OPENING ledger rows so a UI-created party's opening isn't counted twice.
    $initialOpen = (float)($partyRow['opening_balance'] ?? 0) * ((($partyRow['opening_bal_type'] ?? 'cr') === 'cr') ? -1 : 1);
    $ob = $db->prepare("SELECT COALESCE(SUM(debit - credit),0) AS bal FROM ledger WHERE party_id = ? AND txn_date < ? AND txn_type <> 'OPENING'");
    $ob->execute([$partyId, $from]);
    $opening = round($initialOpen + (float)$ob->fetch()['bal'], 2);

    // Transactions in range, with the source document number
    $stmt = $db->prepare("
        SELECT l.txn_date, l.txn_type, l.ref_type, l.ref_id, l.description, l.debit, l.credit,
               COALESCE(sb.bill_no, pb.bill_no, prc.receipt_no) AS ref_no
        FROM ledger l
        LEFT JOIN sales_bills       sb  ON l.ref_type = 'sales_bills'       AND l.ref_id = sb.id
        LEFT JOIN purchase_bills    pb  ON l.ref_type = 'purchase_bills'    AND l.ref_id = pb.id
        LEFT JOIN payments_received prc ON l.ref_type = 'payments_received' AND l.ref_id = prc.id
        WHERE l.party_id = ? AND l.txn_date BETWEEN ? AND ? AND l.txn_type <> 'OPENING'
        ORDER BY l.txn_date, l.id");
    $stmt->execute([$partyId, $from, $to]);
    $rows = $stmt->fetchAll();

    // Running balance
    $bal = $opening;
    $totDebit = 0; $totCredit = 0;
    foreach ($rows as &$r) {
        $bal += (float)$r['debit'] - (float)$r['credit'];
        $r['balance'] = round($bal, 2);
        $totDebit += (float)$r['debit'];
        $totCredit += (float)$r['credit'];
    }
    unset($r);

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'party'   => $partyRow,
        'opening_balance' => round($opening, 2),
        'data'    => $rows,
        'totals'  => ['debit' => round($totDebit, 2), 'credit' => round($totCredit, 2), 'closing' => round($bal, 2)],
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Outstanding totals (sum only) — optionally limited to bills in a date range ----
// Per vendor: purchases (billed to them), payments (cash + discount + adjustment),
// and outstanding (billed − payments). Only vendors still owing are returned.
if ($method === 'GET' && $action === 'outstanding-total') {
    $from = getParam('from');
    $to   = getParam('to');

    $where = "sb.is_cancelled=0";
    $params = [];
    if ($from && $to) { $where .= " AND sb.bill_date BETWEEN ? AND ?"; $params[] = $from; $params[] = $to; }

    $byVendor = $db->prepare("SELECT sb.party_id, p.name_en AS party_name, p.name_ta AS party_name_ta, p.phone1,
               COUNT(*) AS bills,
               COALESCE(SUM(sb.net_amount),0)  AS purchases,
               COALESCE(SUM(sb.paid_amount),0) AS payments,
               COALESCE(SUM(sb.balance_due),0) AS balance_due
        FROM sales_bills sb JOIN parties p ON sb.party_id = p.id
        WHERE $where
        GROUP BY sb.party_id, p.name_en, p.name_ta, p.phone1
        HAVING balance_due > 0
        ORDER BY balance_due DESC");
    $byVendor->execute($params);
    $rows = $byVendor->fetchAll();

    $total = 0; $totPur = 0; $totPaid = 0;
    foreach ($rows as $r) {
        $total   += (float)$r['balance_due'];
        $totPur  += (float)$r['purchases'];
        $totPaid += (float)$r['payments'];
    }

    http_response_code(200);
    echo json_encode(['success' => true,
        'total'           => round($total, 2),
        'total_purchases' => round($totPur, 2),
        'total_payments'  => round($totPaid, 2),
        'vendor_count'    => count($rows),
        'data'            => $rows,
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Outstanding for a day/range — purchases & payments made in the range,
//      alongside each vendor's OVERALL (all-time) outstanding balance. ----
if ($method === 'GET' && $action === 'outstanding-day') {
    $from = getParam('from', businessDate());
    $to   = getParam('to', $from);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$from)) $from = businessDate();
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$to))   $to   = $from;

    $stmt = $db->prepare("
        SELECT p.id AS party_id, p.name_en AS party_name, p.name_ta AS party_name_ta, p.phone1,
               pc.code AS cat_code, pc.name_en AS cat_name,
               COALESCE(c.name_en, p.city) AS city_name,
               COALESCE(dp.day_purchases, 0) AS purchases,
               COALESCE(dp.day_bills, 0)     AS day_bills,
               COALESCE(dr.day_payments, 0)  AS payments,
               COALESCE(ob.balance_due, 0)   AS balance_due
        FROM parties p
        LEFT JOIN party_categories pc ON p.category_id = pc.id
        LEFT JOIN cities c ON p.city_id = c.id
        LEFT JOIN (SELECT party_id, SUM(net_amount) AS day_purchases, COUNT(*) AS day_bills
                   FROM sales_bills WHERE is_cancelled = 0 AND bill_date BETWEEN ? AND ?
                   GROUP BY party_id) dp ON dp.party_id = p.id
        LEFT JOIN (SELECT party_id, SUM(amount + COALESCE(discount_amt,0)) AS day_payments
                   FROM payments_received WHERE receipt_date BETWEEN ? AND ?
                   GROUP BY party_id) dr ON dr.party_id = p.id
        LEFT JOIN (SELECT party_id, SUM(balance_due) AS balance_due
                   FROM sales_bills WHERE is_cancelled = 0
                   GROUP BY party_id) ob ON ob.party_id = p.id
        WHERE COALESCE(dp.day_purchases,0) <> 0
           OR COALESCE(dr.day_payments,0) <> 0
           OR COALESCE(ob.balance_due,0) > 0
        ORDER BY ob.balance_due DESC, dp.day_purchases DESC");
    $stmt->execute([$from, $to, $from, $to]);
    $rows = $stmt->fetchAll();

    $totPur = 0; $totPay = 0; $totBal = 0;
    foreach ($rows as $r) {
        $totPur += (float)$r['purchases'];
        $totPay += (float)$r['payments'];
        $totBal += (float)$r['balance_due'];
    }

    http_response_code(200);
    echo json_encode(['success' => true,
        'from' => $from, 'to' => $to,
        'total_purchases' => round($totPur, 2),
        'total_payments'  => round($totPay, 2),
        'total_outstanding' => round($totBal, 2),
        'vendor_count'    => count($rows),
        'data'            => $rows,
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

// ---- GET: Market outstanding — what WE owe market vendors on held (unsettled) market
//      purchases, with each vendor's sales due netted off to show the net payable. ----
if ($method === 'GET' && $action === 'market-outstanding') {
    $upTo = getParam('up_to', businessDate());
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$upTo)) $upTo = businessDate();

    try {
        $stmt = $db->prepare("
            SELECT p.id AS vendor_id, p.name_en AS vendor_name, p.name_ta AS vendor_name_ta, p.phone1,
                   pc.code AS cat_code, pc.name_en AS cat_name,
                   COALESCE(c.name_en, p.city) AS city_name,
                   mp.owed AS purchases_owed, mp.bill_count,
                   COALESCE(sb.due, 0) AS sales_due
            FROM (SELECT vendor_id, SUM(amount) AS owed, COUNT(*) AS bill_count
                  FROM market_purchases WHERE is_settled = 0 AND purchase_date <= ?
                  GROUP BY vendor_id) mp
            JOIN parties p ON p.id = mp.vendor_id
            LEFT JOIN party_categories pc ON p.category_id = pc.id
            LEFT JOIN cities c ON p.city_id = c.id
            LEFT JOIN (SELECT party_id, SUM(balance_due) AS due
                       FROM sales_bills WHERE is_cancelled = 0
                       GROUP BY party_id) sb ON sb.party_id = p.id
            WHERE mp.owed <> 0
            ORDER BY mp.owed DESC");
        $stmt->execute([$upTo]);
        $rows = $stmt->fetchAll();
    } catch (PDOException $e) {
        $rows = [];   // market tables not present yet
    }

    $totOwed = 0; $totDue = 0; $totNet = 0;
    foreach ($rows as &$r) {
        $owed = (float)$r['purchases_owed'];
        $due  = (float)$r['sales_due'];
        $r['net_payable'] = round($owed - $due, 2);   // +ve = we still owe them after netting their sales
        $totOwed += $owed;
        $totDue  += $due;
        $totNet  += $owed - $due;
    }
    unset($r);

    http_response_code(200);
    echo json_encode(['success' => true,
        'up_to'            => $upTo,
        'total_owed'       => round($totOwed, 2),   // gross we owe on market purchases
        'total_sales_due'  => round($totDue, 2),    // their sales dues to net off
        'total_net'        => round($totNet, 2),    // net payable after netting
        'vendor_count'     => count($rows),
        'data'             => $rows,
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

respondError('Invalid action', 400);
