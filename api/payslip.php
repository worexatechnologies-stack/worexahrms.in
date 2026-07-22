<?php
declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

// This file outputs HTML — override the application/json Content-Type set by bootstrap
header('Content-Type: text/html; charset=utf-8', true);
header('X-Frame-Options: SAMEORIGIN', true);

$user = current_user();

$id = id_param();
if (!$id) fail('Payroll ID required.', 400);

// Fetch payroll record
try {
    $payrollDoc = findOne(collection('payroll'), ['_id' => mongoId($id)]);
} catch (Exception $e) {
    fail('Invalid payroll ID.', 400);
}
if (!$payrollDoc) fail('Payroll record not found.', 404);

// Access control: employees can only see their own payslip
// Compare both as strings to handle ObjectId vs string storage differences
$storedEmpId = (string)($payrollDoc['employee_id'] ?? '');
$currentId   = (string)($user['id'] ?? '');
if ($user['role'] === 'employee' && $storedEmpId !== $currentId) {
    fail('Access denied. emp=' . $currentId . ' stored=' . $storedEmpId, 403);
}

// Fetch employee details
$empId = (string)($payrollDoc['employee_id'] ?? '');
$empDoc = null;
try {
    $empDoc = findOne(collection('employees'), ['_id' => mongoId($empId)]);
} catch (Exception $e) {}
if (!$empDoc) fail('Employee not found.', 404);

// Normalise date fields stored as MongoDB UTCDateTime
function fmtDate(mixed $val): string {
    if ($val instanceof MongoDB\BSON\UTCDateTime) {
        return $val->toDateTime()->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('Y-m-d');
    }
    return (string)($val ?? '');
}

$row = [
    'employee_name'   => $empDoc['name']            ?? '—',
    'employee_code'   => $empDoc['employee_code']   ?? '—',
    'designation'     => $empDoc['designation']     ?? '—',
    'department'      => $empDoc['department']      ?? '—',
    'joining_date'    => fmtDate($empDoc['joining_date'] ?? ''),
    'branch'          => $empDoc['branch']          ?? '—',
    'employment_type' => $empDoc['employment_type'] ?? 'full_time',
    'month'           => (int)($payrollDoc['month']        ?? 0),
    'year'            => (int)($payrollDoc['year']         ?? 0),
    'basic_salary'    => (float)($payrollDoc['basic_salary'] ?? 0),
    'allowances'      => (float)($payrollDoc['allowances']  ?? 0),
    'deductions'      => (float)($payrollDoc['deductions']  ?? 0),
    'net_salary'      => (float)($payrollDoc['net_salary']  ?? 0),
];

$monthNames = ['','January','February','March','April','May','June',
               'July','August','September','October','November','December'];
$monthName  = $monthNames[$row['month']] ?? 'Unknown';
$period     = $monthName . ' ' . $row['year'];

$basic      = $row['basic_salary'];
$allowances = $row['allowances'];
$deductions = $row['deductions'];
$net        = $row['net_salary'];

/* ── company config ── */
$company = [
    'name'    => 'Worexa Technologies',
    'tagline' => 'Technology Solutions Pvt. Ltd.',
    'address' => '3rd Phase, Banashankari 3rd Stage, Bengaluru, Karnataka 560085',
    'cin'     => 'U72200KA2020PTC123456',
    'gstin'   => '29AABCT1234C1Z5',
    'email'   => 'hr@worexatechnologies.com',
];

/* ── logo as base64 ── */
$logoPath = __DIR__ . '/logo_payslip.png';
$logoB64  = file_exists($logoPath) ? 'data:image/png;base64,' . base64_encode(file_get_contents($logoPath)) : '';
$stampPath = __DIR__ . '/stamp.png';
$stampB64  = file_exists($stampPath) ? 'data:image/png;base64,' . base64_encode(file_get_contents($stampPath)) : '';

/* ── number → words (INR style) ── */
function numWords(int $n): string {
    $a = ['','one','two','three','four','five','six','seven','eight','nine','ten',
          'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen',
          'eighteen','nineteen'];
    $b = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
    $t = function(int $x) use ($a,$b): string {
        return $x < 20 ? $a[$x] : $b[(int)($x/10)] . ($x%10 ? ' '.$a[$x%10] : '');
    };
    $h = function(int $x) use ($a,$t): string {
        return $x < 100 ? $t($x) : $a[(int)($x/100)].' hundred'.($x%100 ? ' and '.$t($x%100) : '');
    };
    if ($n === 0) return 'zero';
    $s = ''; $r = abs($n);
    if ($r >= 1e7) { $s .= $h((int)($r/1e7)).' crore '; $r %= (int)1e7; }
    if ($r >= 1e5) { $s .= $h((int)($r/1e5)).' lakh ';  $r %= (int)1e5; }
    if ($r >= 1e3) { $s .= $h((int)($r/1e3)).' thousand '; $r %= 1000; }
    if ($r > 0)    { $s .= $h($r); }
    return trim($s);
}
$netWords = numWords((int)$net);
$netWords = ($netWords === 'zero' ? 'Zero' : ucfirst($netWords)) . ' Rupees Only';

?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Payslip — <?= htmlspecialchars($row['employee_name']) ?> — <?= htmlspecialchars($period) ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --accent:#f97316;--accent-dark:#ea580c;--dark:#0f172a;--mid:#1e293b;
    --text:#1e293b;--muted:#64748b;--dim:#94a3b8;--border:#e2e8f0;--bg:#f8fafc;
  }
  body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);line-height:1.6;
    display:flex;flex-direction:column;align-items:center;padding:32px 20px 60px;min-height:100vh;}
  .toolbar{width:100%;max-width:820px;display:flex;align-items:center;justify-content:space-between;
    margin-bottom:20px;background:#fff;border:1px solid var(--border);border-radius:10px;
    padding:12px 20px;box-shadow:0 1px 3px rgba(0,0,0,.06);}
  .toolbar-title{display:flex;align-items:center;gap:8px;font-family:'Outfit',sans-serif;
    font-size:.95rem;font-weight:600;color:var(--dark);}
  .toolbar-title svg{color:var(--accent)}
  .btn-print{display:inline-flex;align-items:center;gap:7px;padding:9px 22px;
    background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.85rem;
    font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif;
    box-shadow:0 3px 10px rgba(249,115,22,.3);transition:all .2s;}
  .btn-print:hover{background:var(--accent-dark);transform:translateY(-1px)}
  .slip-viewport{width:100%;max-width:820px;background:#fff;
    box-shadow:0 20px 60px rgba(0,0,0,.1),0 1px 3px rgba(0,0,0,.06);
    border-radius:4px;overflow:hidden;}
  .slip-doc{padding:44px 48px;font-size:10px;line-height:1.5;}
  .slip-head{display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:2.5px solid var(--dark);padding-bottom:20px;margin-bottom:24px;}
  .slip-head-left{display:flex;align-items:center;gap:18px}
  .slip-logo{height:80px;max-width:200px;object-fit:contain}
  .slip-company h2{font-family:'Outfit',sans-serif;font-size:1.45rem;font-weight:800;
    color:var(--dark);text-transform:uppercase;line-height:1.1;}
  .slip-company p{font-size:8px;color:var(--muted);margin-top:3px;line-height:1.5}
  .slip-head-right{text-align:right}
  .slip-head-right h3{font-family:'Outfit',sans-serif;font-size:1.3rem;font-weight:800;
    color:var(--dark);text-transform:uppercase;letter-spacing:1px;}
  .slip-period-badge{display:inline-block;margin-top:6px;background:var(--accent);color:#fff;
    font-size:8.5px;font-weight:700;padding:3px 12px;border-radius:20px;text-transform:uppercase;}
  .slip-sec-title{font-family:'Outfit',sans-serif;font-size:7.5px;text-transform:uppercase;
    letter-spacing:.8px;font-weight:700;color:var(--muted);
    border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:10px;}
  .slip-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px 18px;margin-bottom:24px;}
  .slip-grid-item{display:flex;flex-direction:column;gap:1px}
  .slip-label{font-size:7px;text-transform:uppercase;color:var(--dim);font-weight:600;}
  .slip-value{font-size:9.5px;font-weight:600;color:var(--dark)}
  .slip-tbl{display:grid;grid-template-columns:1fr 1fr;border:1px solid #94a3b8;
    border-radius:5px;margin-bottom:24px;overflow:hidden;}
  .slip-tbl-col{display:flex;flex-direction:column}
  .slip-tbl-col:first-child{border-right:1px solid #94a3b8}
  .slip-tbl-hdr{background:#f1f5f9;padding:8px 14px;font-weight:700;text-transform:uppercase;
    font-size:8px;color:#334155;display:flex;justify-content:space-between;
    border-bottom:1px solid #94a3b8;}
  .slip-tbl-row{padding:6px 14px;display:flex;justify-content:space-between;
    border-bottom:1px dashed var(--border);font-size:9px;color:#334155;}
  .slip-tbl-row:last-child{border-bottom:none}
  .slip-tbl-row .amt{font-weight:600;color:var(--dark)}
  .slip-tbl-total{background:#f8fafc;padding:9px 14px;font-weight:700;font-size:9.5px;
    display:flex;justify-content:space-between;border-top:1px solid #94a3b8;margin-top:auto;}
  .slip-net{background:var(--dark);color:#fff;padding:16px 24px;border-radius:5px;
    display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;}
  .slip-net-left{display:flex;flex-direction:column}
  .slip-net-left .lbl{font-size:7px;text-transform:uppercase;opacity:.6;}
  .slip-net-left .words{font-size:8.5px;font-style:italic;margin-top:3px;opacity:.8}
  .slip-net-amt{font-family:'Outfit',sans-serif;font-size:1.6rem;font-weight:800}
  .slip-net-accent{display:inline-block;margin-left:14px;margin-top:4px;background:var(--accent);
    color:#fff;font-size:7.5px;font-weight:700;padding:2px 10px;border-radius:20px;opacity:.9;}
  .slip-foot{display:flex;justify-content:space-between;align-items:flex-end;
    margin-top:28px;font-size:7.5px;color:var(--muted);
    border-top:1px solid var(--border);padding-top:16px;}
  .slip-sign{text-align:right;position:relative;width:280px;padding-top:130px}
  .slip-stamp{position:absolute;width:170px;height:auto;right:4px;bottom:36px;
    mix-blend-mode:multiply;filter:contrast(1.3) saturate(1.25) brightness(.96);
    opacity:.85;transform:rotate(-2deg);pointer-events:none;z-index:10;}
  .slip-sign-line{width:170px;border-top:2px solid var(--dark);margin-left:auto;margin-bottom:6px;}
  .slip-sign .title{font-weight:700;color:var(--dark);margin-bottom:2px;font-size:10px}
  .slip-sign .comp{font-size:8.5px;color:#334155}
  @media print{body{background:#fff!important;padding:0!important}.toolbar{display:none!important}
    .slip-viewport{box-shadow:none!important;width:100%!important;max-width:100%!important}
    .slip-doc{padding:24px 32px!important}}
  @media(max-width:680px){.slip-doc{padding:24px}.slip-head{flex-direction:column;gap:12px}
    .slip-head-right{text-align:left}.slip-grid{grid-template-columns:repeat(2,1fr)}
    .slip-tbl{grid-template-columns:1fr}
    .slip-tbl-col:first-child{border-right:none;border-bottom:1px solid #94a3b8}
    .slip-foot{flex-direction:column;gap:16px;align-items:flex-start}.slip-sign{width:100%}}
</style>
</head>
<body>

<div class="toolbar">
  <div class="toolbar-title">
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
    </svg>
    Payslip — <?= htmlspecialchars($period) ?> — <?= htmlspecialchars($row['employee_name']) ?>
  </div>
  <button class="btn-print" onclick="window.print()">
    <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
      <polyline points="6 9 6 2 18 2 18 9"/>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
      <rect x="6" y="14" width="12" height="8"/>
    </svg>
    Print / Save PDF
  </button>
</div>

<div class="slip-viewport">
  <div class="slip-doc">
    <div class="slip-head">
      <div class="slip-head-left">
        <?php if ($logoB64): ?>
          <img src="<?= $logoB64 ?>" alt="Logo" class="slip-logo">
        <?php else: ?>
          <div style="width:70px;height:70px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-family:'Outfit',sans-serif;font-size:1.8rem;font-weight:800;color:#fff;background:#f97316">W</div>
        <?php endif; ?>
        <div class="slip-company">
          <h2><?= htmlspecialchars($company['name']) ?></h2>
          <p><?= htmlspecialchars($company['tagline']) ?></p>
          <p><?= htmlspecialchars($company['address']) ?></p>
          <p>CIN: <?= htmlspecialchars($company['cin']) ?> &nbsp;|&nbsp; GSTIN: <?= htmlspecialchars($company['gstin']) ?></p>
          <p><?= htmlspecialchars($company['email']) ?></p>
        </div>
      </div>
      <div class="slip-head-right">
        <h3>Payslip</h3>
        <div class="slip-period-badge"><?= htmlspecialchars($period) ?></div>
      </div>
    </div>

    <div class="slip-sec-title">Employee Pay Profile</div>
    <div class="slip-grid">
      <div class="slip-grid-item"><span class="slip-label">Employee Name</span><span class="slip-value"><?= htmlspecialchars($row['employee_name']) ?></span></div>
      <div class="slip-grid-item"><span class="slip-label">Employee ID</span><span class="slip-value"><?= htmlspecialchars($row['employee_code']) ?></span></div>
      <div class="slip-grid-item"><span class="slip-label">Designation</span><span class="slip-value"><?= htmlspecialchars($row['designation']) ?></span></div>
      <div class="slip-grid-item"><span class="slip-label">Department</span><span class="slip-value"><?= htmlspecialchars($row['department']) ?></span></div>
      <div class="slip-grid-item"><span class="slip-label">Date of Joining</span><span class="slip-value"><?= htmlspecialchars($row['joining_date']) ?></span></div>
      <div class="slip-grid-item"><span class="slip-label">Branch</span><span class="slip-value"><?= htmlspecialchars($row['branch']) ?></span></div>
      <div class="slip-grid-item"><span class="slip-label">Employment Type</span><span class="slip-value"><?= htmlspecialchars(ucwords(str_replace('_',' ',$row['employment_type']))) ?></span></div>
      <div class="slip-grid-item"><span class="slip-label">Pay Period</span><span class="slip-value"><?= htmlspecialchars($period) ?></span></div>
    </div>

    <div class="slip-tbl">
      <div class="slip-tbl-col">
        <div class="slip-tbl-hdr"><span>Earnings</span><span>Amount (₹)</span></div>
        <div class="slip-tbl-row"><span>Basic Salary</span><span class="amt">₹<?= number_format($basic, 2) ?></span></div>
        <?php if ($allowances > 0): ?>
        <div class="slip-tbl-row"><span>Allowances</span><span class="amt">₹<?= number_format($allowances, 2) ?></span></div>
        <?php endif; ?>
        <div class="slip-tbl-total"><span>Gross Earnings</span><span>₹<?= number_format($basic + $allowances, 2) ?></span></div>
      </div>
      <div class="slip-tbl-col">
        <div class="slip-tbl-hdr"><span>Deductions</span><span>Amount (₹)</span></div>
        <?php if ($deductions > 0): ?>
        <div class="slip-tbl-row"><span>Total Deductions</span><span class="amt">₹<?= number_format($deductions, 2) ?></span></div>
        <?php else: ?>
        <div class="slip-tbl-row" style="color:#94a3b8"><span>No deductions</span><span>—</span></div>
        <?php endif; ?>
        <div class="slip-tbl-total"><span>Total Deductions</span><span>₹<?= number_format($deductions, 2) ?></span></div>
      </div>
    </div>

    <div class="slip-net">
      <div class="slip-net-left">
        <span class="lbl">Net Pay (Take Home)</span>
        <span class="words"><?= htmlspecialchars($netWords) ?></span>
      </div>
      <div>
        <div class="slip-net-amt">₹<?= number_format($net, 2) ?></div>
        <span class="slip-net-accent">PAID</span>
      </div>
    </div>

    <div class="slip-foot">
      <div>
        <p>This is a computer-generated payslip — no signature required.</p>
        <p>Generated: <?= date('d F Y') ?> at <?= date('h:i A') ?></p>
        <p>For queries: <?= htmlspecialchars($company['email']) ?></p>
      </div>
      <div class="slip-sign">
        <?php if ($stampB64): ?>
          <img src="<?= $stampB64 ?>" alt="Stamp" class="slip-stamp">
        <?php endif; ?>
        <div class="slip-sign-line"></div>
        <p class="title">Authorized Signatory</p>
        <p class="comp"><?= htmlspecialchars($company['name']) ?> Pvt. Ltd.</p>
      </div>
    </div>
  </div>
</div>

</body>
</html>
