<?php
// ============================================================
//  IDNUK SOFTWARE - Public bill view (token link, NO login)
//  GET /api/billview.php?t=<share_token>
//
//  Renders one bill as a printable HTML page. The 32-hex token is random,
//  per-bill, and generated only when the operator taps "WhatsApp" — so only
//  the person the bill was deliberately sent to can open it. No listing,
//  no enumeration, no other data reachable from here.
// ============================================================

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/database.php';

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function money($n): string { return '₹' . number_format((float)$n, 2); }
function fail(string $msg): never {
    http_response_code(404);
    echo "<!doctype html><meta charset='utf-8'><body style='font-family:sans-serif;text-align:center;padding:60px'><h3>" . h($msg) . "</h3></body>";
    exit();
}

$t = $_GET['t'] ?? '';
if (!preg_match('/^[a-f0-9]{32}$/', $t)) fail('Bill not found');

$db = getDB();

// company letterhead from settings (with fallbacks)
$tpl = [];
try {
    $st = $db->prepare("SELECT sval FROM app_settings WHERE skey = 'print_template'");
    $st->execute();
    $row = $st->fetch();
    $tpl = $row ? (json_decode($row['sval'], true) ?: []) : [];
} catch (Throwable $e) {}
$coTa   = $tpl['company_ta'] ?? 'ஸ்ரீ முருகன் அன் கோ.,';
$coEn   = $tpl['company_en'] ?? 'SRI MURUGAN & Co.,';
$coAddr = $tpl['address'] ?? '';
$coTel  = $tpl['phone'] ?? '';
$greet  = $tpl['greeting_left'] ?? 'வாணிபமே கோயில் !';

// ---- find the bill: purchase first, then sales ----
$kind = null; $bill = null; $items = [];

$st = $db->prepare("SELECT pb.*, p.name_en AS party_name, p.name_ta AS party_name_ta, p.city AS town
                    FROM purchase_bills pb JOIN parties p ON pb.party_id = p.id WHERE pb.share_token = ?");
$st->execute([$t]);
if ($bill = $st->fetch()) {
    $kind = 'purchase';
    $it = $db->prepare("SELECT pi.*, pr.name_en AS product_name, pr.name_ta AS product_name_ta
                        FROM purchase_items pi JOIN products pr ON pi.product_id = pr.id
                        WHERE pi.bill_id = ? ORDER BY pi.id");
    $it->execute([$bill['id']]);
    $items = $it->fetchAll();
} else {
    $st = $db->prepare("SELECT sb.*, p.name_en AS party_name, p.name_ta AS party_name_ta, p.city AS town
                        FROM sales_bills sb JOIN parties p ON sb.party_id = p.id WHERE sb.share_token = ?");
    $st->execute([$t]);
    if ($bill = $st->fetch()) {
        $kind = 'sales';
        $it = $db->prepare("SELECT si.*, COALESCE(pr.name_en, si.notes) AS product_name, pr.name_ta AS product_name_ta
                            FROM sales_items si LEFT JOIN products pr ON si.product_id = pr.id
                            WHERE si.bill_id = ? ORDER BY si.id");
        $it->execute([$bill['id']]);
        $items = $it->fetchAll();
    }
}
if (!$bill || !empty($bill['is_cancelled'])) fail('Bill not found');

$dateD = date('d-m-Y', strtotime($bill['bill_date']));
?>
<!doctype html>
<html lang="ta">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?= h($bill['bill_no']) ?> — <?= h($coEn) ?></title>
<style>
  body { font-family: 'Noto Sans Tamil', 'Segoe UI', sans-serif; background:#f3f4f6; margin:0; padding:14px; color:#111; }
  .sheet { max-width: 560px; margin: 0 auto; background:#fff; border:2px solid #2d6a2d; border-radius:8px; overflow:hidden; }
  .head { text-align:center; padding:14px 16px; border-bottom:2px solid #2d6a2d; }
  .head .ta { font-size:20px; font-weight:800; color:#1a5c1a; }
  .head .en { font-size:13px; font-weight:700; color:#1a5c1a; }
  .head .sub { font-size:11px; color:#444; margin-top:2px; }
  .meta { display:flex; justify-content:space-between; padding:10px 16px; border-bottom:1px solid #cfe3cf; font-size:13px; }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:7px 10px; font-size:13px; border-bottom:1px solid #eef2ee; text-align:left; }
  th { background:#e8f5e9; font-size:11px; }
  td.r, th.r { text-align:right; }
  .tot td { font-weight:700; border-top:2px solid #2d6a2d; }
  .net td { font-weight:900; font-size:15px; color:#1a5c1a; background:#f0fdf4; }
  .foot { text-align:center; font-size:12px; color:#1a5c1a; font-weight:700; padding:10px; }
  .print { display:block; margin:14px auto; padding:10px 26px; background:#1a7a45; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:700; cursor:pointer; }
  @media print { body { background:#fff; padding:0 } .print { display:none } .sheet { border-radius:0; max-width:none } }
</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div class="ta"><?= h($coTa) ?></div>
    <div class="en"><?= h($coEn) ?></div>
    <?php if ($coAddr): ?><div class="sub"><?= h($coAddr) ?></div><?php endif; ?>
    <?php if ($coTel): ?><div class="sub"><b><?= h($coTel) ?></b></div><?php endif; ?>
  </div>
  <div class="meta">
    <div>
      <b>திரு. <?= h($bill['party_name']) ?></b>
      <?php if ($bill['party_name_ta']): ?> / <?= h($bill['party_name_ta']) ?><?php endif; ?><br>
      <span style="color:#555">ஊர்: <?= h($bill['town'] ?: '—') ?></span>
    </div>
    <div style="text-align:right">
      எண்: <b><?= h($bill['bill_no']) ?></b><br>
      தேதி: <b><?= h($dateD) ?></b>
    </div>
  </div>
  <table>
    <thead>
      <tr><th>விபரம்</th><th class="r">எடை</th><th class="r">எண்ணம்</th><th class="r">ரேட்</th><th class="r">தொகை</th></tr>
    </thead>
    <tbody>
    <?php foreach ($items as $it):
        $isPur = $kind === 'purchase';
        $wt   = $isPur ? $it['billed_weight'] : $it['vendor_weight'];
        $rate = $isPur ? $it['purchase_rate'] : $it['sale_rate'];
        $amt  = $isPur ? $it['gross_amount']  : $it['net_amount'];
    ?>
      <tr>
        <td><?= h($it['product_name']) ?><?php if (!empty($it['product_name_ta'])): ?> <span style="color:#666"><?= h($it['product_name_ta']) ?></span><?php endif; ?></td>
        <td class="r"><?= (float)$wt > 0 ? h(rtrim(rtrim(number_format((float)$wt, 2, '.', ''), '0'), '.')) . ' kg' : '—' ?></td>
        <td class="r"><?= (int)$it['no_of_bags'] ?: '—' ?></td>
        <td class="r"><?= h(rtrim(rtrim(number_format((float)$rate, 2, '.', ''), '0'), '.')) ?></td>
        <td class="r"><?= h(number_format((float)$amt, 2)) ?></td>
      </tr>
    <?php endforeach; ?>
    <?php if ($kind === 'purchase'): ?>
      <tr class="tot"><td colspan="4">மொத்தம் / Gross</td><td class="r"><?= h(number_format((float)$bill['subtotal_amount'], 2)) ?></td></tr>
      <?php
        $ded = [
            ['கமிஷன்', $bill['total_commission']], ['கூலி', $bill['total_cooly_amt']],
            ['ரொக்கம்', $bill['total_sakku_amt']], ['சுங்கம்', $bill['total_sungam_amt']],
            ['வாடகை', $bill['lorry_freight']],
        ];
        foreach ($ded as [$lbl, $v]) if ((float)$v > 0): ?>
          <tr><td colspan="4" style="color:#555"><?= h($lbl) ?></td><td class="r" style="color:#b91c1c">− <?= h(number_format((float)$v, 2)) ?></td></tr>
      <?php endif; ?>
      <tr class="net"><td colspan="4">நிகர தொகை / NET PAYABLE</td><td class="r"><?= h(number_format((float)$bill['net_payable'], 2)) ?></td></tr>
    <?php else: ?>
      <tr class="tot"><td colspan="4">பில் தொகை / Bill Total</td><td class="r"><?= h(number_format((float)$bill['net_amount'], 2)) ?></td></tr>
      <?php if ((float)$bill['balance_due'] > 0): ?>
        <tr class="net"><td colspan="4">நிலுவை / BALANCE DUE</td><td class="r"><?= h(number_format((float)$bill['balance_due'], 2)) ?></td></tr>
      <?php endif; ?>
    <?php endif; ?>
    </tbody>
  </table>
  <div class="foot"><?= h($greet) ?></div>
</div>
<button class="print" onclick="window.print()">🖨️ Print / சேமிக்க</button>
</body>
</html>
