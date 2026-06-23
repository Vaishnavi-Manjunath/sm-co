<?php
// ============================================================
//  IDNUK SOFTWARE - Admin / data tools (admin role only)
//  GET  /api/admin?action=counts        - row counts of key tables
//  POST /api/admin?action=reset-import  - WIPE all data + import master
//       body: { confirm:"RESET-AND-IMPORT", opening_date?:"YYYY-MM-DD" }
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/helpers/api.php';

$user   = requireAuth();
if (($user['role'] ?? '') !== 'admin') respondError('Admin only', 403);
$method = $_SERVER['REQUEST_METHOD'];
$action = getParam('action', 'counts');
$db     = getDB();

// Tables that hold data we may wipe (kept list is everything NOT here)
$DATA_TABLES = [
    'sales_items', 'sales_bills', 'purchase_items', 'purchase_bills',
    'payments_received', 'payment_allocations', 'farmer_payouts', 'ledger',
    'yard_allocations', 'yard_entries', 'sales_staged_items',
    'daily_expenses', 'daily_rates', 'tally_exports', 'party_truck_links',
    'parties', 'products', 'bill_sequences',
];

function tableCount($db, $t) {
    try { return (int)$db->query("SELECT COUNT(*) FROM `$t`")->fetchColumn(); }
    catch (Exception $e) { return null; }   // table absent
}

// ---- GET: counts ----
if ($method === 'GET' && $action === 'counts') {
    $out = [];
    foreach ($DATA_TABLES as $t) { $c = tableCount($db, $t); if ($c !== null) $out[$t] = $c; }
    respond($out);
}

// ---- POST: wipe everything and import master data from data/import_master.json ----
if ($method === 'POST' && $action === 'reset-import') {
    $b = getBody();
    if (($b['confirm'] ?? '') !== 'RESET-AND-IMPORT') respondError('Confirmation token required', 400);
    $openingDate = $b['opening_date'] ?? date('Y-m-01');

    $path = $_SERVER['DOCUMENT_ROOT'] . '/data/import_master.json';
    if (!is_file($path)) respondError('import_master.json not found on server', 500);
    $data = json_decode(file_get_contents($path), true);
    if (!$data || empty($data['parties'])) respondError('Import file empty or invalid', 500);

    $before = [];
    foreach ($DATA_TABLES as $t) { $c = tableCount($db, $t); if ($c !== null) $before[$t] = $c; }

    @set_time_limit(600);
    $db->exec('SET FOREIGN_KEY_CHECKS=0');
    try {
        // 1) WIPE
        foreach ($DATA_TABLES as $t) {
            try { $db->exec("TRUNCATE TABLE `$t`"); } catch (Exception $e) {}
        }

        // 2) Category code -> id
        $cats = [];
        foreach ($db->query("SELECT id, code FROM party_categories")->fetchAll() as $c) $cats[$c['code']] = (int)$c['id'];

        // 3) Parties (batched). Keep code -> new id for opening bills.
        $cols = "(code, name_en, name_ta, category_id, city, is_active, opening_balance, opening_bal_type, commission_pct)";
        $parties = $data['parties'];
        $chunk = 400;
        for ($i = 0; $i < count($parties); $i += $chunk) {
            $slice = array_slice($parties, $i, $chunk);
            $vals = []; $args = [];
            foreach ($slice as $p) {
                $catId = $cats[$p['category']] ?? null;
                if (!$catId) continue;
                $opening = (float)($p['opening'] ?? 0);
                $vals[] = "(?,?,?,?,?,?,?,?,?)";
                array_push($args,
                    $p['code'], $p['name_en'], ($p['name_ta'] ?? '') ?: null, $catId,
                    ($p['city'] ?? '') ?: null, (int)($p['is_active'] ?? 1),
                    $opening, 'dr', 10);
            }
            if ($vals) $db->prepare("INSERT INTO parties $cols VALUES " . implode(',', $vals))->execute($args);
        }

        // map code -> id
        $idByCode = [];
        foreach ($db->query("SELECT id, code FROM parties")->fetchAll() as $r) $idByCode[$r['code']] = (int)$r['id'];

        // 4) Opening outstanding bills for vendors that owe us
        $openCount = 0; $openTotal = 0; $seq = 0;
        $stmt = $db->prepare("INSERT INTO sales_bills
            (bill_no, bill_date, bill_time, party_id, credit_days, due_date,
             subtotal_weight, subtotal_amount, discount_amt, total_sakku_amt, total_cooly_amt,
             net_amount, balance_due, payment_status, notes, created_by)
            VALUES (?,?,NOW(),?,?,?,?,?,?,?,?,?,?,?,?,?)");
        foreach ($parties as $p) {
            $opening = (float)($p['opening'] ?? 0);
            if ($opening <= 0) continue;
            $pid = $idByCode[$p['code']] ?? null;
            if (!$pid) continue;
            $seq++;
            $billNo = 'OPEN-' . str_pad($seq, 5, '0', STR_PAD_LEFT);
            $stmt->execute([$billNo, $openingDate, $pid, 0, $openingDate,
                0, $opening, 0, 0, 0, $opening, $opening, 'unpaid', 'Opening balance (legacy)', $user['id']]);
            $openCount++; $openTotal += $opening;
        }

        // 5) Products
        $prodCols = "(code, name_en, name_ta, unit_type, bag_deduction_kg, vendor_short_kg, sort_order)";
        $sort = 0; $pvals = []; $pargs = [];
        foreach ($data['products'] as $pr) {
            $sort++;
            $pvals[] = "(?,?,?,?,?,?,?)";
            array_push($pargs, $pr['code'], $pr['name_en'], ($pr['name_ta'] ?? '') ?: null,
                $pr['unit_type'] ?? 'KG', 3, 0, $sort);
        }
        if ($pvals) $db->prepare("INSERT INTO products $prodCols VALUES " . implode(',', $pvals))->execute($pargs);

        $db->exec('SET FOREIGN_KEY_CHECKS=1');

        $after = [];
        foreach ($DATA_TABLES as $t) { $c = tableCount($db, $t); if ($c !== null) $after[$t] = $c; }

        respond([
            'wiped'            => $before,
            'imported_parties' => count($idByCode),
            'opening_bills'    => $openCount,
            'opening_total'    => round($openTotal, 2),
            'imported_products'=> tableCount($db, 'products'),
            'after'            => $after,
        ]);
    } catch (Exception $e) {
        $db->exec('SET FOREIGN_KEY_CHECKS=1');
        respondServerError('Import', $e);
    }
}

// ---- Fix farmer cities from legacy st1 (FARMERS ONLY — customers untouched) ----
//  GET  ?action=fix-farmer-cities                  -> preview (no writes)
//  POST ?action=fix-farmer-cities {confirm:"FIX-CITIES"} -> apply
if ($action === 'fix-farmer-cities') {
    $path = $_SERVER['DOCUMENT_ROOT'] . '/data/farmer_city_fix.json';
    if (!is_file($path)) respondError('farmer_city_fix.json not found on server', 500);
    $fix = json_decode(file_get_contents($path), true);
    if (!$fix || empty($fix['farmers'])) respondError('Fix file empty or invalid', 500);

    $farmerCat = (int)($db->query("SELECT id FROM party_categories WHERE code='FARMER'")->fetchColumn() ?: 0);
    if (!$farmerCat) respondError('FARMER category not found', 500);

    // current city by code (farmers only — never touch other categories)
    $cur = [];
    $st = $db->prepare("SELECT code, city FROM parties WHERE category_id = ?");
    $st->execute([$farmerCat]);
    foreach ($st->fetchAll() as $r) $cur[$r['code']] = (string)($r['city'] ?? '');

    $matched = 0; $willChange = 0; $missing = 0; $sample = [];
    foreach ($fix['farmers'] as $f) {
        if (!array_key_exists($f['code'], $cur)) { $missing++; continue; }
        $matched++;
        if ($cur[$f['code']] !== (string)$f['city']) {
            $willChange++;
            if (count($sample) < 12) $sample[] = ['code' => $f['code'], 'old' => $cur[$f['code']], 'new' => $f['city']];
        }
    }

    if ($method !== 'POST') {
        respond(['mode' => 'preview', 'matched' => $matched, 'will_change' => $willChange, 'missing' => $missing, 'sample' => $sample]);
    }

    $b = getBody();
    if (($b['confirm'] ?? '') !== 'FIX-CITIES') respondError('Confirmation token FIX-CITIES required', 400);
    @set_time_limit(300);
    $upd = $db->prepare("UPDATE parties SET city = ? WHERE code = ? AND category_id = ?");
    $n = 0;
    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        foreach ($fix['farmers'] as $f) {
            if (!array_key_exists($f['code'], $cur)) continue;
            if ($cur[$f['code']] === (string)$f['city']) continue;
            $upd->execute([$f['city'], $f['code'], $farmerCat]);
            $n += $upd->rowCount();
        }
        if ($db->inTransaction()) { $db->commit(); }
        auditLog('UPDATE', 'farmer_cities', null, "Fixed farmer cities from legacy village (st1)", ['updated' => $n]);
        respond(['mode' => 'applied', 'updated' => $n, 'missing' => $missing]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed', $e);
    }
}

// ---- Backfill the Cities master from each party's legacy city text + link city_id ----
//  The legacy import stored every party's village/town in parties.city (plain text)
//  but never added them to the `cities` master nor set parties.city_id. This promotes
//  each distinct city text into the cities master and links every party to it, so the
//  city shows up in the Cities panel and the party form's City dropdown.
//  GET  ?action=backfill-cities                          -> preview (no writes)
//  POST ?action=backfill-cities {confirm:"BACKFILL-CITIES"} -> apply
if ($action === 'backfill-cities') {
    // Ensure the cities table exists (it is created lazily by parties.php).
    $db->exec("CREATE TABLE IF NOT EXISTS cities (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name_en     VARCHAR(100) NOT NULL,
        name_ta     VARCHAR(100),
        sort_order  INT DEFAULT 100,
        is_active   TINYINT(1) DEFAULT 1,
        UNIQUE KEY uniq_name (name_en)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    try { $db->exec("ALTER TABLE parties ADD COLUMN city_id INT UNSIGNED NULL DEFAULT NULL"); } catch (PDOException $e) {}

    // Every party that carries a legacy city text (trimmed, non-empty).
    $rows = $db->query("SELECT p.id, p.city_id, TRIM(p.city) AS city, pc.code AS cat_code
        FROM parties p LEFT JOIN party_categories pc ON p.category_id = pc.id
        WHERE p.city IS NOT NULL AND TRIM(p.city) <> ''")->fetchAll();

    $distinct = [];          // city text => true
    $byCat    = [];          // cat_code => count of parties with a city
    foreach ($rows as $r) {
        $distinct[$r['city']] = true;
        $byCat[$r['cat_code'] ?: '?'] = ($byCat[$r['cat_code'] ?: '?'] ?? 0) + 1;
    }
    $names = array_keys($distinct);

    // Which of those city names already exist in the master.
    $existing = [];          // name_en => id
    if ($names) {
        $in = implode(',', array_fill(0, count($names), '?'));
        $cs = $db->prepare("SELECT id, name_en FROM cities WHERE name_en IN ($in)");
        $cs->execute($names);
        foreach ($cs->fetchAll() as $c) $existing[$c['name_en']] = (int)$c['id'];
    }
    $toCreate = array_values(array_filter($names, fn($n) => !isset($existing[$n])));
    // Parties that still need their city_id set/corrected.
    $needLink = 0;
    foreach ($rows as $r) {
        $cid = $existing[$r['city']] ?? null;          // may become known only after create
        if ($cid === null || (int)$r['city_id'] !== $cid) $needLink++;
    }

    if ($method !== 'POST') {
        respond(['mode' => 'preview',
            'parties_with_city' => count($rows),
            'distinct_cities'   => count($names),
            'cities_to_create'  => count($toCreate),
            'cities_existing'   => count($existing),
            'parties_to_link'   => $needLink,
            'by_category'       => $byCat,
            'sample_new'        => array_slice($toCreate, 0, 15)]);
    }

    $b = getBody();
    if (($b['confirm'] ?? '') !== 'BACKFILL-CITIES') respondError('Confirmation token BACKFILL-CITIES required', 400);
    @set_time_limit(300);

    if (!$db->inTransaction()) { $db->beginTransaction(); }
    try {
        // 1) Promote each distinct city text into the master (idempotent).
        $ins = $db->prepare("INSERT IGNORE INTO cities (name_en) VALUES (?)");
        $created = 0;
        foreach ($toCreate as $n) { $ins->execute([$n]); $created += $ins->rowCount(); }

        // 2) Re-read the full name => id map (now covers the just-created rows).
        $map = [];
        if ($names) {
            $in = implode(',', array_fill(0, count($names), '?'));
            $cs = $db->prepare("SELECT id, name_en FROM cities WHERE name_en IN ($in)");
            $cs->execute($names);
            foreach ($cs->fetchAll() as $c) $map[$c['name_en']] = (int)$c['id'];
        }

        // 3) Link each party to its city (only when it changes).
        $upd = $db->prepare("UPDATE parties SET city_id = ? WHERE id = ?");
        $linked = 0;
        foreach ($rows as $r) {
            $cid = $map[$r['city']] ?? null;
            if ($cid === null) continue;
            if ((int)$r['city_id'] === $cid) continue;
            $upd->execute([$cid, $r['id']]);
            $linked += $upd->rowCount();
        }

        if ($db->inTransaction()) { $db->commit(); }
        auditLog('UPDATE', 'cities_backfill', null, 'Backfilled cities master from party city text + linked city_id',
            ['cities_created' => $created, 'parties_linked' => $linked]);
        respond(['mode' => 'applied', 'cities_created' => $created, 'parties_linked' => $linked,
            'distinct_cities' => count($names)]);
    } catch (Exception $e) {
        if ($db->inTransaction()) { $db->rollBack(); }
        respondServerError('Failed', $e);
    }
}

// ---- Import 03-06 outstanding: transactions-only purge + set customer/supplier openings ----
//  GET  ?action=import-outstanding                          -> dry-run preview (no writes)
//  POST ?action=import-outstanding {confirm:"IMPORT-OUTSTANDING"} -> apply
if ($action === 'import-outstanding') {
    $path = $_SERVER['DOCUMENT_ROOT'] . '/data/outstanding_import.json';
    if (!is_file($path)) respondError('outstanding_import.json not found on server', 500);
    $imp = json_decode(file_get_contents($path), true);
    if (!$imp || empty($imp['customers'])) respondError('Import file empty or invalid', 500);
    $asOf = $imp['as_of'] ?? date('Y-m-d');

    // code -> party (current)
    $byCode = [];
    foreach ($db->query("SELECT id, code, name_en, opening_balance FROM parties")->fetchAll() as $r) $byCode[$r['code']] = $r;

    $existing = array_merge($imp['customers'], $imp['suppliers_existing'] ?? []);
    $matched = []; $missing = [];
    foreach ($existing as $c) {
        if (isset($byCode[$c['code']])) $matched[] = [
            'code' => $c['code'], 'name' => $byCode[$c['code']]['name_en'],
            'old' => (float)$byCode[$c['code']]['opening_balance'], 'new' => (float)$c['total'],
        ];
        else $missing[] = $c['code'];
    }
    // new suppliers that don't already exist
    $newSup = [];
    foreach (($imp['suppliers_new'] ?? []) as $s) if (!isset($byCode[$s['code']])) $newSup[] = $s;

    $sumMatched = array_sum(array_map(fn($m) => $m['new'], $matched));
    $sumNew     = array_sum(array_map(fn($s) => (float)$s['total'], $newSup));

    // ---- Preview (GET) ----
    if ($method !== 'POST') {
        respond([
            'mode' => 'preview', 'as_of' => $asOf,
            'matched_count' => count($matched), 'matched_total' => round($sumMatched, 2),
            'sample' => array_slice($matched, 0, 8),
            'new_suppliers' => array_map(fn($s) => ['code' => $s['code'], 'total' => (float)$s['total']], $newSup),
            'new_suppliers_total' => round($sumNew, 2),
            'missing_codes' => $missing,
            'grand_total' => round($sumMatched + $sumNew, 2),
            'note' => 'Apply will WIPE all transactional data (bills, payments, ledger, yard, market, expenses), reset every opening to 0, then set these openings + create OPEN- bills. Parties/products/settings are kept.',
        ]);
    }

    // ---- Apply (POST) ----
    $b = getBody();
    if (($b['confirm'] ?? '') !== 'IMPORT-OUTSTANDING') respondError('Confirmation token IMPORT-OUTSTANDING required', 400);

    $TXN = ['sales_items', 'sales_bills', 'purchase_items', 'purchase_bills', 'payments_received',
            'payment_allocations', 'farmer_payouts', 'ledger', 'yard_allocations', 'yard_entries',
            'sales_staged_items', 'daily_expenses', 'tally_exports', 'market_purchases', 'market_settlements'];
    @set_time_limit(600);
    $db->exec('SET FOREIGN_KEY_CHECKS=0');
    try {
        foreach ($TXN as $t) { try { $db->exec("TRUNCATE TABLE `$t`"); } catch (Exception $e) {} }
        $db->exec("UPDATE parties SET opening_balance = 0, opening_bal_type = 'dr'");

        // create new supplier parties
        $supCat = (int)($db->query("SELECT id FROM party_categories WHERE code='SUPPLIER'")->fetchColumn() ?: 0);
        if ($supCat) {
            $insP = $db->prepare("INSERT INTO parties (code, name_en, category_id, is_active, opening_balance, opening_bal_type, commission_pct) VALUES (?,?,?,1,?, 'dr', 10)");
            foreach ($newSup as $s) $insP->execute([$s['code'], $s['name_en'] ?? $s['code'], $supCat, (float)$s['total']]);
        }
        // refresh code -> id
        $idByCode = [];
        foreach ($db->query("SELECT id, code FROM parties")->fetchAll() as $r) $idByCode[$r['code']] = (int)$r['id'];

        $openStmt = $db->prepare("INSERT INTO sales_bills
            (bill_no, bill_date, bill_time, party_id, credit_days, due_date,
             subtotal_weight, subtotal_amount, discount_amt, total_sakku_amt, total_cooly_amt,
             net_amount, balance_due, payment_status, notes, created_by)
            VALUES (?,?,NOW(),?,?,?,?,?,?,?,?,?,?,?,?,?)");
        $updOpen = $db->prepare("UPDATE parties SET opening_balance = ?, opening_bal_type = 'dr' WHERE code = ?");

        $all = array_merge(
            $imp['customers'],
            $imp['suppliers_existing'] ?? [],
            array_map(fn($s) => ['code' => $s['code'], 'total' => $s['total']], $newSup)
        );
        $seq = 0; $count = 0; $total = 0;
        foreach ($all as $row) {
            $pid = $idByCode[$row['code']] ?? null; if (!$pid) continue;
            $amt = round((float)$row['total'], 2); if ($amt <= 0) continue;
            $updOpen->execute([$amt, $row['code']]);
            $seq++; $billNo = 'OPEN-' . str_pad($seq, 5, '0', STR_PAD_LEFT);
            $openStmt->execute([$billNo, $asOf, $pid, 0, $asOf, 0, 0, 0, 0, 0, $amt, $amt, 'unpaid', "Opening balance as of $asOf", $user['id']]);
            $count++; $total += $amt;
        }
        $db->exec('SET FOREIGN_KEY_CHECKS=1');
        auditLog('IMPORT', 'outstanding', null, "Imported outstanding as of $asOf", ['opening_bills' => $count, 'total' => round($total, 2), 'new_suppliers' => count($newSup)]);
        respond(['mode' => 'applied', 'as_of' => $asOf, 'opening_bills' => $count, 'opening_total' => round($total, 2),
                 'new_suppliers' => count($newSup), 'missing_codes' => $missing]);
    } catch (Exception $e) {
        $db->exec('SET FOREIGN_KEY_CHECKS=1');
        respondServerError('Import', $e);
    }
}

// ============================================================
//  Legacy historical bills import (purchase + sales) + correct vendor dues to 31-May closing.
//  GET  ?action=import-legacy-bills                                  -> preview (no writes)
//  POST ?action=import-legacy-bills {confirm:"IMPORT-LEGACY-BILLS"}  -> apply (idempotent, re-runnable)
//  POST ?action=revert-legacy-bills {confirm:"REVERT-LEGACY-BILLS"}  -> remove imported bills, restore openings
//  Bills load fully SETTLED (no ledger rows) so they never double-count against balances.
// ============================================================
if ($action === 'import-legacy-bills' || $action === 'revert-legacy-bills') {
    $path = $_SERVER['DOCUMENT_ROOT'] . '/data/bills_import.json';
    if (!is_file($path)) respondError('bills_import.json not found on server', 500);
    $imp = json_decode(file_get_contents($path), true);
    if (!$imp) respondError('bills_import.json invalid', 500);
    $asOf = $imp['as_of'] ?? date('Y-m-d');

    $delLegacy = function () use ($db) {
        $db->exec("DELETE si FROM sales_items si JOIN sales_bills sb ON si.bill_id=sb.id WHERE sb.bill_no LIKE 'LS%'");
        $db->exec("DELETE FROM sales_bills WHERE bill_no LIKE 'LS%'");
        $db->exec("DELETE pi FROM purchase_items pi JOIN purchase_bills pb ON pi.bill_id=pb.id WHERE pb.bill_no LIKE 'LP%'");
        $db->exec("DELETE FROM purchase_bills WHERE bill_no LIKE 'LP%'");
    };

    // ---- REVERT ----
    if ($action === 'revert-legacy-bills') {
        if ($method !== 'POST') respondError('POST required', 405);
        $b = getBody();
        if (($b['confirm'] ?? '') !== 'REVERT-LEGACY-BILLS') respondError('Confirmation token REVERT-LEGACY-BILLS required', 400);
        @set_time_limit(600);
        $db->beginTransaction();
        try {
            $delLegacy();
            // restore vendor openings from the original opdebit in import_master.json
            $mpath = $_SERVER['DOCUMENT_ROOT'] . '/data/import_master.json';
            $master = is_file($mpath) ? json_decode(file_get_contents($mpath), true) : null;
            $restored = 0;
            if ($master) {
                $opByCode = [];
                foreach ($master['parties'] as $p) $opByCode[$p['code']] = (float)($p['opening'] ?? 0);
                foreach ($db->query("SELECT id, code FROM parties")->fetchAll() as $r) {
                    if (!array_key_exists($r['code'], $opByCode)) continue;
                    $op = round($opByCode[$r['code']], 2);
                    $db->prepare("UPDATE parties SET opening_balance=? WHERE id=?")->execute([$op, $r['id']]);
                    $db->prepare("UPDATE sales_bills SET subtotal_amount=?, net_amount=?, balance_due=?, payment_status='unpaid'
                                  WHERE party_id=? AND bill_no LIKE 'OPEN-%'")->execute([$op, $op, $op, $r['id']]);
                    $restored++;
                }
            }
            $db->commit();
            auditLog('IMPORT', 'legacy_bills', null, 'Reverted legacy bills import', ['openings_restored' => $restored]);
            respond(['mode' => 'reverted', 'openings_restored' => $restored]);
        } catch (Exception $e) { if ($db->inTransaction()) $db->rollBack(); respondServerError('Revert', $e); }
    }

    $purchases = $imp['purchases'] ?? []; $sales = $imp['sales'] ?? [];
    $newParties = $imp['new_parties'] ?? []; $closings = $imp['closings'] ?? [];
    $haveCodes = [];
    foreach ($db->query("SELECT code FROM parties")->fetchAll(PDO::FETCH_COLUMN) as $c) $haveCodes[$c] = 1;
    $toCreate = 0; foreach ($newParties as $p) if (empty($haveCodes[$p['code']])) $toCreate++;
    $closeTotal = round(array_sum(array_map(fn($c) => (float)$c['balance'], $closings)), 2);

    // ---- PREVIEW (GET) ----
    if ($method !== 'POST') {
        respond([
            'mode' => 'preview', 'as_of' => $asOf, 'range' => $imp['range'] ?? null,
            'purchase_bills' => count($purchases), 'sales_bills' => count($sales),
            'new_parties_in_file' => count($newParties), 'new_parties_to_create' => $toCreate,
            'vendor_dues_to_update' => count($closings), 'closings_total' => $closeTotal,
            'already_imported' => [
                'purchase' => (int)$db->query("SELECT COUNT(*) FROM purchase_bills WHERE bill_no LIKE 'LP%'")->fetchColumn(),
                'sales'    => (int)$db->query("SELECT COUNT(*) FROM sales_bills WHERE bill_no LIKE 'LS%'")->fetchColumn(),
            ],
            'note' => 'Apply inserts these as fully-settled historical bills (no ledger rows), auto-creates missing parties, and sets every vendor outstanding to its closing balance. Re-runnable; a revert action is available.',
        ]);
    }

    // ---- APPLY (POST) ----
    $b = getBody();
    if (($b['confirm'] ?? '') !== 'IMPORT-LEGACY-BILLS') respondError('Confirmation token IMPORT-LEGACY-BILLS required', 400);
    @set_time_limit(600);
    $db->beginTransaction();
    try {
        // 1) remove any prior legacy import (idempotent)
        $delLegacy();

        // 2) create missing parties
        $cats = []; foreach ($db->query("SELECT id, code FROM party_categories")->fetchAll() as $c) $cats[$c['code']] = (int)$c['id'];
        $insP = $db->prepare("INSERT INTO parties (code,name_en,name_ta,category_id,city,is_active,opening_balance,opening_bal_type,commission_pct)
                              VALUES (?,?,?,?,?,1,0,'dr',10)");
        $created = 0;
        foreach ($newParties as $p) {
            if (!empty($haveCodes[$p['code']])) continue;
            $cid = $cats[$p['category']] ?? null; if (!$cid) continue;
            $insP->execute([$p['code'], ($p['name_en'] ?: $p['code']), ($p['name_ta'] ?? '') ?: null, $cid, ($p['city'] ?? '') ?: null]);
            $created++;
        }
        $idByCode = []; foreach ($db->query("SELECT id, code FROM parties")->fetchAll() as $r) $idByCode[$r['code']] = (int)$r['id'];
        $prodByCode = []; foreach ($db->query("SELECT id, code FROM products")->fetchAll() as $r) $prodByCode[$r['code']] = (int)$r['id'];

        // 3) purchase bills (fully settled — no ledger)
        $pbStmt = $db->prepare("INSERT INTO purchase_bills
            (bill_no,bill_date,bill_time,party_id,party_type,lorry_party_id,lorry_no,lorry_freight,commission_pct,
             subtotal_weight,subtotal_amount,total_commission,total_sakku_amt,total_cooly_amt,total_sungam_amt,
             total_advance,other_deductions,net_payable,payment_status,payment_mode,payment_ref,notes,reference_name,created_by)
            VALUES (?,?,NOW(),?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,'paid','cash',NULL,'LEGACY',?,?)");
        $piStmt = $db->prepare("INSERT INTO purchase_items
            (bill_id,product_id,actual_weight,bag_deduction,billed_weight,no_of_bags,unit_type,purchase_rate,gross_amount,
             commission_pct,commission_amt,sakku_qty,sakku_rate,sakku_amt,cooly_amt,sungam_amt,net_amount,notes,weights_detail,damage_kg)
            VALUES (?,?,?,0,?,?,'KG',?,?,0,?,?,?,?,?,?,?,NULL,'',0)");
        $pCount = 0; $pSkip = 0;
        foreach ($purchases as $bil) {
            $pid = $idByCode[$bil['party_code']] ?? null; if (!$pid) { $pSkip++; continue; }
            // Derive the effective commission % from the amount so edits keep the right commission/net.
            $gross = (float)($bil['subtotal_amount'] ?? 0);
            $commPct = $gross > 0 ? round((float)($bil['total_commission'] ?? 0) / $gross * 100, 2) : 0;
            $pbStmt->execute([$bil['bill_no'], $bil['bill_date'], $pid, $bil['party_type'] ?? 'FARMER',
                $bil['lorry_freight'] ?? 0, $commPct,
                $bil['subtotal_weight'] ?? 0, $bil['subtotal_amount'] ?? 0, $bil['total_commission'] ?? 0,
                $bil['total_sakku_amt'] ?? 0, $bil['total_cooly_amt'] ?? 0, $bil['total_sungam_amt'] ?? 0,
                0, 0, $bil['net_payable'] ?? 0, $bil['reference'] ?? '', $user['id']]);
            $bid = $db->lastInsertId();
            foreach ($bil['items'] as $it) {
                $prodId = $prodByCode[$it['pcode']] ?? null; if (!$prodId) continue;
                $piStmt->execute([$bid, $prodId, $it['billed_weight'], $it['billed_weight'], $it['no_of_bags'],
                    $it['purchase_rate'], $it['gross_amount'], $it['commission_amt'], $it['sakku_qty'], $it['sakku_rate'],
                    $it['sakku_amt'], $it['cooly_amt'], $it['sungam_amt'], $it['net_amount']]);
            }
            $pCount++;
        }

        // 4) sales bills (fully settled — no ledger)
        $sbStmt = $db->prepare("INSERT INTO sales_bills
            (bill_no,bill_date,bill_time,party_id,salesman,credit_days,due_date,subtotal_weight,subtotal_amount,
             discount_pct,discount_amt,total_sakku_amt,total_cooly_amt,net_amount,balance_due,payment_status,notes,created_by)
            VALUES (?,?,NOW(),?,NULL,0,?,?,?,0,?,?,?,?,0,'paid','LEGACY',?)");
        $siStmt = $db->prepare("INSERT INTO sales_items
            (bill_id,purchase_item_id,product_id,no_of_bags,vendor_weight,purchase_weight,weight_profit,unit_type,
             purchase_rate,sale_rate,gross_amount,discount_pct,discount_amt,sakku_qty,sakku_rate,sakku_amt,cooly_amt,net_amount,margin_amount,notes)
            VALUES (?,NULL,?,?,?,0,0,'KG',0,?,?,0,?,?,?,?,?,?,0,NULL)");
        $sCount = 0; $sSkip = 0;
        foreach ($sales as $bil) {
            $pid = $idByCode[$bil['party_code']] ?? null; if (!$pid) { $sSkip++; continue; }
            $sbStmt->execute([$bil['bill_no'], $bil['bill_date'], $pid, $bil['bill_date'],
                $bil['subtotal_weight'] ?? 0, $bil['subtotal_amount'] ?? 0,
                $bil['discount_amt'] ?? 0, $bil['total_sakku_amt'] ?? 0, $bil['total_cooly_amt'] ?? 0,
                $bil['net_amount'] ?? 0, $user['id']]);
            $bid = $db->lastInsertId();
            foreach ($bil['items'] as $it) {
                $prodId = $prodByCode[$it['pcode']] ?? null; if (!$prodId) continue;
                $siStmt->execute([$bid, $prodId, $it['no_of_bags'], $it['vendor_weight'],
                    $it['sale_rate'], $it['gross_amount'], $it['discount_amt'],
                    $it['sakku_qty'], $it['sakku_rate'], $it['sakku_amt'], $it['cooly_amt'], $it['net_amount']]);
            }
            $sCount++;
        }

        // 5) set every vendor's outstanding to its 31-May closing (0 if not in the closings list)
        $custCat = (int)($db->query("SELECT id FROM party_categories WHERE code='CUSTOMER'")->fetchColumn() ?: 0);
        $closeByCode = []; foreach ($closings as $c) $closeByCode[$c['code']] = (float)$c['balance'];
        $updOpen   = $db->prepare("UPDATE parties SET opening_balance=?, opening_bal_type='dr' WHERE id=?");
        $findOpen  = $db->prepare("SELECT id FROM sales_bills WHERE party_id=? AND bill_no LIKE 'OPEN-%' LIMIT 1");
        $updOpenB  = $db->prepare("UPDATE sales_bills SET subtotal_amount=?, net_amount=?, balance_due=?, payment_status=IF(?>0,'unpaid','paid') WHERE id=?");
        $insOpenB  = $db->prepare("INSERT INTO sales_bills (bill_no,bill_date,bill_time,party_id,credit_days,due_date,subtotal_weight,subtotal_amount,discount_amt,total_sakku_amt,total_cooly_amt,net_amount,balance_due,payment_status,notes,created_by)
                                   VALUES (?,?,NOW(),?,0,?,0,?,0,0,0,?,?,'unpaid',?,?)");
        $openSeq = (int)$db->query("SELECT COALESCE(MAX(CAST(SUBSTRING(bill_no,6) AS UNSIGNED)),0) FROM sales_bills WHERE bill_no LIKE 'OPEN-%'")->fetchColumn();
        $duesUpdated = 0;
        foreach ($db->query("SELECT id, code FROM parties WHERE category_id=$custCat")->fetchAll() as $r) {
            $bal = round($closeByCode[$r['code']] ?? 0.0, 2);
            $updOpen->execute([$bal, $r['id']]);
            $findOpen->execute([$r['id']]); $openId = $findOpen->fetchColumn();
            if ($openId) {
                $updOpenB->execute([$bal, $bal, $bal, $bal, $openId]);
            } elseif ($bal > 0) {
                $openSeq++; $bn = 'OPEN-' . str_pad($openSeq, 5, '0', STR_PAD_LEFT);
                $insOpenB->execute([$bn, $asOf, $r['id'], $asOf, $bal, $bal, $bal, "Balance as of $asOf (legacy)", $user['id']]);
            }
            $duesUpdated++;
        }

        $db->commit();
        auditLog('IMPORT', 'legacy_bills', null, "Imported legacy bills as of $asOf",
            ['purchase' => $pCount, 'sales' => $sCount, 'parties_created' => $created, 'dues_updated' => $duesUpdated, 'closings_total' => $closeTotal]);
        respond(['mode' => 'applied', 'as_of' => $asOf,
            'purchase_bills' => $pCount, 'purchase_skipped' => $pSkip,
            'sales_bills' => $sCount, 'sales_skipped' => $sSkip,
            'parties_created' => $created, 'vendor_dues_updated' => $duesUpdated,
            'closings_total' => $closeTotal]);
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        respondServerError('Legacy bills import', $e);
    }
}

// ============================================================
//  SCOPED ADDITIVE IMPORT — only dated bills + outstanding sync, match by code, never create.
//  Reads data/scoped_import.json (built by scripts/build_scoped_import.py).
//   GET  ?action=import-scoped                            -> preview (read-only)
//   POST ?action=import-scoped  {confirm:"SCOPED-IMPORT"} -> apply (idempotent on IMP- bills)
//   POST ?action=revert-scoped  {confirm:"REVERT-SCOPED"} -> remove the IMP- bills
//  Touches ONLY: IMP-P/IMP-S bills for the window, and matched parties' opening/OPEN- balance.
// ============================================================
if ($action === 'import-scoped' || $action === 'revert-scoped') {
    $path = $_SERVER['DOCUMENT_ROOT'] . '/data/scoped_import.json';
    if (!is_file($path)) respondError('scoped_import.json not found on server', 500);
    $imp = json_decode(file_get_contents($path), true);
    if (!$imp) respondError('scoped_import.json invalid', 500);
    $purchases = $imp['purchases'] ?? []; $sales = $imp['sales'] ?? []; $closings = $imp['closings'] ?? [];
    $asOf = $imp['to'] ?? date('Y-m-d');

    $delScoped = function () use ($db) {
        $db->exec("DELETE si FROM sales_items si JOIN sales_bills sb ON si.bill_id=sb.id WHERE sb.bill_no LIKE 'IMP-S%'");
        $db->exec("DELETE FROM sales_bills WHERE bill_no LIKE 'IMP-S%'");
        $db->exec("DELETE pi FROM purchase_items pi JOIN purchase_bills pb ON pi.bill_id=pb.id WHERE pb.bill_no LIKE 'IMP-P%'");
        $db->exec("DELETE FROM purchase_bills WHERE bill_no LIKE 'IMP-P%'");
    };

    if ($action === 'revert-scoped') {
        if ($method !== 'POST') respondError('POST required', 405);
        if ((getBody()['confirm'] ?? '') !== 'REVERT-SCOPED') respondError('Confirmation token REVERT-SCOPED required', 400);
        $db->beginTransaction();
        try { $delScoped(); $db->commit();
              auditLog('IMPORT', 'scoped', null, 'Reverted scoped import (IMP- bills removed)');
              respond(['mode' => 'reverted']); }
        catch (Exception $e) { if ($db->inTransaction()) $db->rollBack(); respondServerError('Revert scoped', $e); }
    }

    // Existing parties/products by code (NEVER create)
    $idByCode = []; foreach ($db->query("SELECT id, code FROM parties")->fetchAll() as $r) $idByCode[$r['code']] = (int)$r['id'];
    $prodByCode = []; foreach ($db->query("SELECT id, code FROM products")->fetchAll() as $r) $prodByCode[$r['code']] = (int)$r['id'];

    $unmatched = [];   // code => name_ta (parties not in our system)
    $pMatched = 0; $pUn = 0; $sMatched = 0; $sUn = 0;
    foreach ($purchases as $b) { if (!empty($idByCode[$b['party_code']])) $pMatched++; else { $pUn++; if ($b['party_code'] !== '') $unmatched[$b['party_code']] = $b['party_name_ta']; } }
    foreach ($sales as $b)     { if (!empty($idByCode[$b['party_code']])) $sMatched++; else { $sUn++; if ($b['party_code'] !== '') $unmatched[$b['party_code']] = $b['party_name_ta']; } }
    $closeMatched = []; $closeUn = [];
    foreach ($closings as $c) { if (!empty($idByCode[$c['code']])) $closeMatched[] = $c; else $closeUn[$c['code']] = $c['name_ta']; }
    $unmatchedList = []; foreach ($unmatched as $code => $name) $unmatchedList[] = ['code' => $code, 'name' => $name];

    // ---- PREVIEW (GET) — read-only ----
    if ($method !== 'POST') {
        $sample = [];
        $cur = $db->prepare("SELECT COALESCE(SUM(balance_due),0) FROM sales_bills WHERE party_id=? AND payment_status IN ('unpaid','partial')");
        foreach (array_slice($closeMatched, 0, 15) as $c) {
            $cur->execute([$idByCode[$c['code']]]);
            $sample[] = ['code' => $c['code'], 'name' => $c['name_ta'],
                         'current' => round((float)$cur->fetchColumn(), 2), 'legacy' => round((float)$c['balance'], 2)];
        }
        respond([
            'mode' => 'preview', 'window' => [$imp['from'] ?? null, $asOf],
            'purchase_bills_matched' => $pMatched, 'purchase_unmatched' => $pUn,
            'sales_bills_matched' => $sMatched, 'sales_unmatched' => $sUn,
            'outstanding_parties_matched' => count($closeMatched), 'outstanding_unmatched' => count($closeUn),
            'already_imported' => [
                'purchase' => (int)$db->query("SELECT COUNT(*) FROM purchase_bills WHERE bill_no LIKE 'IMP-P%'")->fetchColumn(),
                'sales'    => (int)$db->query("SELECT COUNT(*) FROM sales_bills WHERE bill_no LIKE 'IMP-S%'")->fetchColumn(),
            ],
            'unmatched_parties' => $unmatchedList,
            'outstanding_sample' => $sample,
            'note' => 'Apply inserts only these dated bills for matched parties (as settled records) and overwrites each matched party\'s outstanding so its total equals the legacy figure. Unmatched parties are reported, not created. Re-runnable; revert-scoped removes the IMP- bills.',
        ]);
    }

    // ---- APPLY (POST) ----
    if ((getBody()['confirm'] ?? '') !== 'SCOPED-IMPORT') respondError('Confirmation token SCOPED-IMPORT required', 400);
    @set_time_limit(600);
    $db->beginTransaction();
    try {
        $delScoped();   // idempotent

        // Purchase bills (settled records)
        $pb = $db->prepare("INSERT INTO purchase_bills
            (bill_no,bill_date,bill_time,party_id,party_type,lorry_party_id,lorry_no,lorry_freight,commission_pct,
             subtotal_weight,subtotal_amount,total_commission,total_sakku_amt,total_cooly_amt,total_sungam_amt,
             total_advance,other_deductions,net_payable,payment_status,payment_mode,payment_ref,notes,reference_name,created_by)
            VALUES (?,?,NOW(),?,'FARMER',NULL,NULL,?,?,?,?,?,0,?,?,?,0,?,'paid','cash',NULL,'LEGACY-SYNC',?,?)");
        $pi = $db->prepare("INSERT INTO purchase_items
            (bill_id,product_id,actual_weight,bag_deduction,billed_weight,no_of_bags,unit_type,purchase_rate,gross_amount,
             commission_pct,commission_amt,sakku_qty,sakku_rate,sakku_amt,cooly_amt,sungam_amt,net_amount,notes,weights_detail,damage_kg)
            VALUES (?,?,?,0,?,?,'KG',?,?,0,?,0,0,0,?,?,?,NULL,'',0)");
        $pCount = 0;
        foreach ($purchases as $bil) {
            $pid = $idByCode[$bil['party_code']] ?? null; if (!$pid) continue;
            $gross = (float)($bil['subtotal_amount'] ?? 0);
            $commPct = $gross > 0 ? round((float)($bil['total_commission'] ?? 0) / $gross * 100, 2) : 0;
            $pb->execute([$bil['bill_no'], $bil['bill_date'], $pid, $bil['lorry_freight'] ?? 0, $commPct,
                $bil['subtotal_weight'] ?? 0, $bil['subtotal_amount'] ?? 0, $bil['total_commission'] ?? 0,
                $bil['total_cooly_amt'] ?? 0, $bil['total_sungam_amt'] ?? 0, $bil['total_advance'] ?? 0,
                $bil['net_payable'] ?? 0, $bil['reference'] ?? '', $user['id']]);
            $bid = $db->lastInsertId();
            foreach ($bil['items'] as $it) {
                $prodId = $prodByCode[$it['pcode']] ?? null; if (!$prodId) continue;
                $pi->execute([$bid, $prodId, $it['billed_weight'], $it['billed_weight'], $it['no_of_bags'],
                    $it['purchase_rate'], $it['gross_amount'], $it['commission_amt'], $it['cooly_amt'],
                    $it['sungam_amt'], $it['net_amount']]);
            }
            $pCount++;
        }

        // Sales bills (settled records)
        $sb = $db->prepare("INSERT INTO sales_bills
            (bill_no,bill_date,bill_time,party_id,salesman,credit_days,due_date,subtotal_weight,subtotal_amount,
             discount_pct,discount_amt,total_sakku_amt,total_cooly_amt,net_amount,balance_due,payment_status,notes,created_by)
            VALUES (?,?,NOW(),?,NULL,0,?,?,?,0,?,0,?,?,0,'paid','LEGACY-SYNC',?)");
        $si = $db->prepare("INSERT INTO sales_items
            (bill_id,purchase_item_id,product_id,no_of_bags,vendor_weight,purchase_weight,weight_profit,unit_type,
             purchase_rate,sale_rate,gross_amount,discount_pct,discount_amt,sakku_qty,sakku_rate,sakku_amt,cooly_amt,net_amount,margin_amount,notes)
            VALUES (?,NULL,?,?,?,0,0,'KG',0,?,?,0,?,0,0,0,?,?,0,NULL)");
        $sCount = 0;
        foreach ($sales as $bil) {
            $pid = $idByCode[$bil['party_code']] ?? null; if (!$pid) continue;
            $sb->execute([$bil['bill_no'], $bil['bill_date'], $pid, $bil['bill_date'],
                $bil['subtotal_weight'] ?? 0, $bil['subtotal_amount'] ?? 0,
                $bil['discount_amt'] ?? 0, $bil['total_cooly_amt'] ?? 0, $bil['net_amount'] ?? 0, $user['id']]);
            $bid = $db->lastInsertId();
            foreach ($bil['items'] as $it) {
                $prodId = $prodByCode[$it['pcode']] ?? null; if (!$prodId) continue;
                $si->execute([$bid, $prodId, $it['no_of_bags'], $it['vendor_weight'],
                    $it['sale_rate'], $it['gross_amount'], $it['discount_amt'], $it['cooly_amt'], $it['net_amount']]);
            }
            $sCount++;
        }

        // Outstanding sync: make each matched party's TOTAL outstanding equal its legacy closing.
        // total = OPEN-bill + other unpaid bills, so OPEN-bill target = legacy - other-unpaid (>=0).
        $other   = $db->prepare("SELECT COALESCE(SUM(balance_due),0) FROM sales_bills WHERE party_id=? AND payment_status IN ('unpaid','partial') AND bill_no NOT LIKE 'OPEN-%'");
        $findOpen= $db->prepare("SELECT id FROM sales_bills WHERE party_id=? AND bill_no LIKE 'OPEN-%' LIMIT 1");
        $updOpen = $db->prepare("UPDATE sales_bills SET subtotal_amount=?, net_amount=?, balance_due=?, payment_status=IF(?>0,'unpaid','paid') WHERE id=?");
        $insOpen = $db->prepare("INSERT INTO sales_bills (bill_no,bill_date,bill_time,party_id,credit_days,due_date,subtotal_weight,subtotal_amount,discount_amt,total_sakku_amt,total_cooly_amt,net_amount,balance_due,payment_status,notes,created_by)
                                 VALUES (?,?,NOW(),?,0,?,0,?,0,0,0,?,?,IF(?>0,'unpaid','paid'),?,?)");
        $updParty= $db->prepare("UPDATE parties SET opening_balance=?, opening_bal_type='dr' WHERE id=?");
        $openSeq = (int)$db->query("SELECT COALESCE(MAX(CAST(SUBSTRING(bill_no,6) AS UNSIGNED)),0) FROM sales_bills WHERE bill_no LIKE 'OPEN-%'")->fetchColumn();
        $duesUpdated = 0; $overflowed = [];
        foreach ($closeMatched as $c) {
            $pid = $idByCode[$c['code']]; $legacy = round((float)$c['balance'], 2);
            $other->execute([$pid]); $oth = round((float)$other->fetchColumn(), 2);
            $openTarget = round($legacy - $oth, 2);
            if ($openTarget < 0) { $overflowed[] = ['code' => $c['code'], 'legacy' => $legacy, 'other_unpaid' => $oth]; $openTarget = 0; }
            $updParty->execute([$openTarget, $pid]);
            $findOpen->execute([$pid]); $openId = $findOpen->fetchColumn();
            if ($openId) { $updOpen->execute([$openTarget, $openTarget, $openTarget, $openTarget, $openId]); }
            else { $openSeq++; $bn = 'OPEN-' . str_pad($openSeq, 5, '0', STR_PAD_LEFT);
                   $insOpen->execute([$bn, $asOf, $pid, $asOf, $openTarget, $openTarget, $openTarget, $openTarget, "Balance as of $asOf (legacy sync)", $user['id']]); }
            $duesUpdated++;
        }

        $db->commit();
        auditLog('IMPORT', 'scoped', null, "Scoped import [{$imp['from']}..$asOf]",
            ['purchase' => $pCount, 'sales' => $sCount, 'dues_updated' => $duesUpdated, 'unmatched' => count($unmatchedList)]);
        respond(['mode' => 'applied', 'window' => [$imp['from'] ?? null, $asOf],
            'purchase_bills' => $pCount, 'sales_bills' => $sCount, 'outstanding_updated' => $duesUpdated,
            'unmatched_parties' => $unmatchedList, 'outstanding_overflow' => $overflowed]);
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        respondServerError('Scoped import', $e);
    }
}

// ============================================================
//  RECONCILE OUTSTANDING TO LEDGER — the ledger (debit−credit) is the source of truth.
//  The Outstanding report sums unpaid bill balance_due, which can drift above the ledger
//  when a vendor pays an advance/overpayment (ledger credited, no bill to reduce).
//   GET  ?action=reconcile-outstanding                              -> preview (read-only)
//   POST ?action=reconcile-outstanding {confirm:"RECONCILE-OUTSTANDING"} -> set each party's
//        outstanding to its ledger balance (via its OPEN- bill). Re-runnable.
// ============================================================
if ($action === 'reconcile-outstanding') {
  try {
    // Ledger balance per party (the truth)
    $ledBal = [];
    foreach ($db->query("SELECT party_id, ROUND(SUM(debit)-SUM(credit),2) AS bal FROM ledger WHERE party_id IS NOT NULL GROUP BY party_id")->fetchAll() as $r)
        $ledBal[(int)$r['party_id']] = (float)$r['bal'];
    // Current outstanding per party (sum of unpaid bill balance_due)
    $outDue = [];
    foreach ($db->query("SELECT party_id, ROUND(SUM(balance_due),2) AS due FROM sales_bills
                         WHERE is_cancelled=0 AND payment_status IN ('unpaid','partial','overdue') GROUP BY party_id")->fetchAll() as $r)
        $outDue[(int)$r['party_id']] = (float)$r['due'];

    // Parties involved on either side (array_values: re-index so PDO positional binding works)
    $ids = array_values(array_unique(array_merge(array_keys($ledBal), array_keys($outDue))));
    $name = [];
    if ($ids) {
        $in = implode(',', array_fill(0, count($ids), '?'));
        $st = $db->prepare("SELECT id, code, name_en, name_ta FROM parties WHERE id IN ($in)");
        $st->execute($ids);
        foreach ($st->fetchAll() as $r) $name[(int)$r['id']] = $r;
    }
    $mismatches = [];
    foreach ($ids as $pid) {
        $bal = round($ledBal[$pid] ?? 0, 2);
        $due = round($outDue[$pid] ?? 0, 2);
        if (abs($bal - $due) < 0.005) continue;
        $mismatches[] = ['party_id' => $pid, 'code' => $name[$pid]['code'] ?? '',
            'name' => $name[$pid]['name_ta'] ?: ($name[$pid]['name_en'] ?? ''),
            'outstanding' => $due, 'ledger' => $bal, 'diff' => round($due - $bal, 2)];
    }
    usort($mismatches, fn($a, $b) => abs($b['diff']) <=> abs($a['diff']));
    $totalDiff = round(array_sum(array_map(fn($m) => $m['diff'], $mismatches)), 2);

    if ($method !== 'POST') {
        respond(['mode' => 'preview', 'mismatched_parties' => count($mismatches),
            'net_overstatement' => $totalDiff,
            'sample' => array_slice($mismatches, 0, 50),
            'note' => 'Apply sets each listed party\'s outstanding to its ledger balance (the truth) by adjusting its OPEN- bill. Nothing else changes; re-runnable.']);
    }

    if ((getBody()['confirm'] ?? '') !== 'RECONCILE-OUTSTANDING') respondError('Confirmation token RECONCILE-OUTSTANDING required', 400);
    @set_time_limit(600);
    $db->beginTransaction();
    try {
        $other   = $db->prepare("SELECT COALESCE(SUM(balance_due),0) FROM sales_bills WHERE party_id=? AND payment_status IN ('unpaid','partial','overdue') AND bill_no NOT LIKE 'OPEN-%'");
        $findOpen= $db->prepare("SELECT id FROM sales_bills WHERE party_id=? AND bill_no LIKE 'OPEN-%' LIMIT 1");
        $updOpen = $db->prepare("UPDATE sales_bills SET subtotal_amount=?, net_amount=?, balance_due=?, payment_status=IF(?>0,'unpaid','paid') WHERE id=?");
        $insOpen = $db->prepare("INSERT INTO sales_bills (bill_no,bill_date,bill_time,party_id,credit_days,due_date,subtotal_weight,subtotal_amount,discount_amt,total_sakku_amt,total_cooly_amt,net_amount,balance_due,payment_status,notes,created_by)
                                 VALUES (?,?,NOW(),?,0,?,0,?,0,0,0,?,?,IF(?>0,'unpaid','paid'),?,?)");
        $updParty= $db->prepare("UPDATE parties SET opening_balance=?, opening_bal_type='dr' WHERE id=?");
        $openSeq = (int)$db->query("SELECT COALESCE(MAX(CAST(SUBSTRING(bill_no,6) AS UNSIGNED)),0) FROM sales_bills WHERE bill_no LIKE 'OPEN-%'")->fetchColumn();
        $asOf = date('Y-m-d'); $fixed = 0;
        foreach ($mismatches as $m) {
            $pid = $m['party_id']; $bal = round($m['ledger'], 2);
            $other->execute([$pid]); $oth = round((float)$other->fetchColumn(), 2);
            $openTarget = round($bal - $oth, 2); if ($openTarget < 0) $openTarget = 0;
            $updParty->execute([$openTarget, $pid]);
            $findOpen->execute([$pid]); $openId = $findOpen->fetchColumn();
            if ($openId) { $updOpen->execute([$openTarget, $openTarget, $openTarget, $openTarget, $openId]); }
            else { $openSeq++; $bn = 'OPEN-' . str_pad($openSeq, 5, '0', STR_PAD_LEFT);
                   $insOpen->execute([$bn, $asOf, $pid, $asOf, $openTarget, $openTarget, $openTarget, $openTarget, "Balance reconciled to ledger ($asOf)", $user['id']]); }
            $fixed++;
        }
        $db->commit();
        auditLog('IMPORT', 'reconcile', null, 'Reconciled outstanding to ledger', ['parties' => $fixed, 'net' => $totalDiff]);
        respond(['mode' => 'applied', 'parties_fixed' => $fixed, 'net_overstatement_cleared' => $totalDiff]);
    } catch (Exception $e) { if ($db->inTransaction()) $db->rollBack(); respondServerError('Reconcile outstanding', $e); }
  } catch (Exception $e) {
    if ($db->inTransaction()) $db->rollBack();
    respondServerError('Reconcile outstanding', $e);
  }
}

// ============================================================
//  SET LEGACY BALANCES FROM THE BALANCE-LIST SHEET (data/legacy_balances.json).
//  Cutoff model: keep all bills but mark them PAID up to `as_of`, wipe the pre-cutoff
//  ledger, then set each LISTED customer's opening balance + a single opening ledger
//  entry to the sheet figure. Parties not in the sheet end at 0. Sheet = source of truth.
//   GET  ?action=set-legacy-balances                                 -> preview (read-only)
//   POST ?action=set-legacy-balances {confirm:"SET-LEGACY-BALANCES"} -> apply
// ============================================================
if ($action === 'set-legacy-balances') {
  try {
    $path = $_SERVER['DOCUMENT_ROOT'] . '/data/legacy_balances.json';
    if (!is_file($path)) respondError('legacy_balances.json not found on server', 500);
    $data = json_decode(file_get_contents($path), true);
    if (!$data || empty($data['balances'])) respondError('legacy_balances.json empty/invalid', 500);
    $asOf = preg_replace('/[^0-9-]/', '', $data['as_of'] ?? '2026-06-19');   // sanitise (used inline)
    $balances = $data['balances'];

    $idByCode = []; foreach ($db->query("SELECT id, code FROM parties")->fetchAll() as $r) $idByCode[$r['code']] = (int)$r['id'];
    $matched = []; $unmatched = [];
    foreach ($balances as $b) {
        if (!empty($idByCode[$b['code']])) $matched[] = ['code' => $b['code'], 'pid' => $idByCode[$b['code']], 'balance' => round((float)$b['balance'], 2)];
        else $unmatched[] = $b['code'];
    }
    $totalBal = round(array_sum(array_map(fn($m) => $m['balance'], $matched)), 2);

    // ---- PREVIEW ----
    if ($method !== 'POST') {
        $billsToPay = (int)$db->query("SELECT COUNT(*) FROM sales_bills WHERE is_cancelled=0 AND bill_date<='$asOf' AND payment_status<>'paid'")->fetchColumn()
                    + (int)$db->query("SELECT COUNT(*) FROM purchase_bills WHERE is_cancelled=0 AND bill_date<='$asOf' AND payment_status<>'paid'")->fetchColumn();
        $billsAfter = (int)$db->query("SELECT COUNT(*) FROM sales_bills WHERE is_cancelled=0 AND bill_date>'$asOf' AND payment_status<>'paid' AND bill_no NOT LIKE 'OPEN-%'")->fetchColumn();
        $cur     = $db->prepare("SELECT COALESCE(SUM(balance_due),0) FROM sales_bills WHERE party_id=? AND is_cancelled=0 AND payment_status IN ('unpaid','partial','overdue')");
        $openBal = $db->prepare("SELECT bill_no, balance_due, payment_status FROM sales_bills WHERE party_id=? AND bill_no LIKE 'OPEN-%' LIMIT 1");
        $sample = []; $verifyOk = 0; $verifyMissing = []; $verifyWrong = [];
        foreach ($matched as $m) {
            $cur->execute([$m['pid']]); $curBal = round((float)$cur->fetchColumn(), 2);
            $openBal->execute([$m['pid']]); $ob = $openBal->fetch();
            if (count($sample) < 20) $sample[] = ['code' => $m['code'], 'current' => $curBal, 'target' => $m['balance']];
            if (!$ob) { $verifyMissing[] = $m['code']; }
            elseif (abs((float)$ob['balance_due'] - $m['balance']) > 0.5) { $verifyWrong[] = ['code' => $m['code'], 'open_bill' => $ob['bill_no'], 'db_bal' => (float)$ob['balance_due'], 'sheet_bal' => $m['balance'], 'status' => $ob['payment_status']]; }
            else { $verifyOk++; }
        }
        respond(['mode' => 'preview', 'as_of' => $asOf, 'customers_matched' => count($matched), 'unmatched' => $unmatched,
            'target_total' => $totalBal, 'bills_to_mark_paid' => $billsToPay, 'unpaid_bills_after_cutoff' => $billsAfter,
            'sample' => $sample,
            'verify' => ['open_bills_correct' => $verifyOk, 'open_bills_missing' => $verifyMissing, 'open_bills_wrong' => $verifyWrong],
            'note' => "Apply marks all bills up to $asOf as PAID (kept, not deleted), clears the pre-cutoff ledger, then sets each listed customer's opening balance + ledger to the sheet figure. Sheet customers not yet in the system are auto-created as Market vendors. Parties not in the sheet end at 0. NOT auto-reversible — download a backup first."]);
    }

    // ---- APPLY ----
    if ((getBody()['confirm'] ?? '') !== 'SET-LEGACY-BALANCES') respondError('Confirmation token SET-LEGACY-BALANCES required', 400);
    @set_time_limit(600);
    $db->beginTransaction();
    try {
        // 1) Mark every pre-cutoff bill PAID (keeps the bill rows; zeros outstanding).
        $db->exec("UPDATE sales_bills SET balance_due=0, paid_amount=net_amount, payment_status='paid' WHERE is_cancelled=0 AND bill_date<='$asOf'");
        $db->exec("UPDATE purchase_bills SET payment_status='paid' WHERE is_cancelled=0 AND bill_date<='$asOf'");
        // 2) Clean slate: remove ALL previous OPEN- bills and ALL OPENING ledger entries.
        //    This makes the tool safe to re-run any number of times without accumulating stale rows.
        $db->exec("DELETE FROM sales_bills WHERE bill_no LIKE 'OPEN-%'");
        $db->exec("DELETE FROM ledger WHERE txn_type='OPENING'");
        // 3) Auto-create any listed customer that doesn't exist yet as a Market vendor.
        $toSet = $matched; $created = 0;
        if (!empty($unmatched)) {
            $mvCat = (int)($db->query("SELECT id FROM party_categories WHERE code='MARKET_VENDOR'")->fetchColumn() ?: 0);
            $balByCode = []; foreach ($balances as $b) $balByCode[$b['code']] = round((float)$b['balance'], 2);
            $insParty = $db->prepare("INSERT INTO parties (code,name_en,category_id,is_active,opening_balance,opening_bal_type,commission_pct) VALUES (?,?,?,1,0,'dr',10)");
            foreach ($unmatched as $code) {
                if (!$mvCat) break;
                $insParty->execute([$code, $code, $mvCat]);
                $toSet[] = ['code' => $code, 'pid' => (int)$db->lastInsertId(), 'balance' => $balByCode[$code] ?? 0];
                $created++;
            }
        }
        // 4) Fresh OPEN- bill + opening ledger row for every listed party (always INSERT — no find/update).
        $updParty = $db->prepare("UPDATE parties SET opening_balance=?, opening_bal_type='dr' WHERE id=?");
        $insOpen  = $db->prepare("INSERT INTO sales_bills (bill_no,bill_date,bill_time,party_id,credit_days,due_date,subtotal_weight,subtotal_amount,discount_amt,total_sakku_amt,total_cooly_amt,net_amount,balance_due,payment_status,notes,created_by)
                                  VALUES (?,?,NOW(),?,0,?,0,?,0,0,0,?,?,IF(?>0,'unpaid','paid'),?,?)");
        $insLed   = $db->prepare("INSERT INTO ledger (txn_date,txn_type,ref_type,ref_id,party_id,description,debit,credit,created_by) VALUES (?,'OPENING','opening',NULL,?,?,?,?,?)");
        $set = 0;
        foreach ($toSet as $i => $m) {
            $pid = $m['pid']; $bal = $m['balance'];
            $updParty->execute([$bal, $pid]);
            $bn = 'OPEN-' . str_pad($i + 1, 5, '0', STR_PAD_LEFT);
            $insOpen->execute([$bn, $asOf, $pid, $asOf, $bal, $bal, $bal, $bal, "Opening balance as of $asOf", $user['id']]);
            $dr = $bal >= 0 ? $bal : 0; $cr = $bal < 0 ? -$bal : 0;
            $insLed->execute([$asOf, $pid, 'Opening balance (legacy book)', $dr, $cr, $user['id']]);
            $set++;
        }
        $db->commit();
        auditLog('IMPORT', 'legacy_balances', null, "Set legacy balances as of $asOf", ['customers' => $set, 'created' => $created, 'total' => $totalBal]);
        respond(['mode' => 'applied', 'as_of' => $asOf, 'customers_set' => $set, 'customers_created' => $created, 'target_total' => $totalBal, 'created_codes' => $unmatched]);
    } catch (Exception $e) { if ($db->inTransaction()) $db->rollBack(); respondServerError('Set legacy balances', $e); }
  } catch (Exception $e) {
    respondServerError('Set legacy balances', $e);
  }
}

respondError('Invalid action', 400);
