<?php
/**
 * Attendance Sheet API
 *
 * GET  /api/attendance-sheet.php?employee_id=XXX&month=2026-01
 *      Returns full month rows (one per calendar day) — HR only
 *
 * GET  /api/attendance-sheet.php?my=1&month=2026-01
 *      Returns own sheet — employee
 *
 * PUT  /api/attendance-sheet.php?task_status=1
 *      Body: { date, status }  — employee updates their own task status
 *            status: "pending" | "completed"
 *            Only allowed for today.
 *            Past dates are auto-set to "completed" by the GET call.
 */

declare(strict_types=1);
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$currentUser = current_user();
date_default_timezone_set('Asia/Kolkata');
markMissedAttendanceAbsent();

$method = method();

/* ─── Task status update (employee) ─── */
if ($method === 'PUT' && !empty($_GET['task_status'])) {
    if ($currentUser['role'] !== 'employee') fail('Only employees can update task status.', 403);

    $data   = input();
    $date   = trim((string)($data['date'] ?? ''));
    $status = trim((string)($data['status'] ?? ''));

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) fail('Invalid date.', 422);
    if (!in_array($status, ['pending', 'completed'], true)) fail('Status must be pending or completed.', 422);

    $today = date('Y-m-d');
    if ($date !== $today) fail('Task status can only be changed for today.', 400);

    $rec = findOne(collection('attendance'), [
        'employee_id' => $currentUser['id'],
        'date'        => $date,
    ]);
    if (!$rec) fail('No attendance record for this date.', 404);

    updateOne(collection('attendance'), ['_id' => $rec['_id']], [
        'task_status' => $status,
        'updated_at'  => date('Y-m-d H:i:s'),
    ]);
    ok(['date' => $date, 'task_status' => $status], 'Task status updated.');
}

/* ─── Determine employee_id and access ─── */
if ($method === 'GET') {
    $isHr      = $currentUser['role'] === 'hr';
    $isMy      = !empty($_GET['my']);
    $empIdParam = trim($_GET['employee_id'] ?? '');

    if ($isHr && !$isMy && $empIdParam === '') {
        // HR must specify an employee or use my=1
        fail('employee_id is required for HR.', 422);
    }

    if ($isMy || !$isHr) {
        $empId  = $currentUser['id'];
        $empDoc = $currentUser;
    } else {
        if (!preg_match('/^[a-f\d]{24}$/i', $empIdParam)) fail('Invalid employee_id.', 422);
        $empDoc = findOne(collection('employees'), ['_id' => mongoId($empIdParam)]);
        if (!$empDoc) fail('Employee not found.', 404);
        $empId = (string)$empDoc['_id'];
    }

    /* ─── Date range: month OR custom ─── */
    $monthParam = trim($_GET['month'] ?? '');    // e.g. 2026-01
    $fromParam  = trim($_GET['from']  ?? '');    // e.g. 2026-01-01
    $toParam    = trim($_GET['to']    ?? '');    // e.g. 2026-01-31

    if ($fromParam && $toParam) {
        // Custom range
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromParam) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $toParam)) {
            fail('from / to must be YYYY-MM-DD.', 422);
        }
        $startDate = $fromParam;
        $endDate   = $toParam;
    } elseif ($monthParam) {
        if (!preg_match('/^\d{4}-\d{2}$/', $monthParam)) fail('month must be YYYY-MM.', 422);
        $startDate = $monthParam . '-01';
        $endDate   = date('Y-m-t', strtotime($startDate)); // last day of month
    } else {
        // Default: current month
        $startDate = date('Y-m-01');
        $endDate   = date('Y-m-t');
    }

    // Clamp end date to today (don't show future dates as absent)
    $today = date('Y-m-d');
    if ($endDate > $today) $endDate = $today;
    if ($startDate > $endDate) {
        ok(['rows' => [], 'summary' => emptySummary($empDoc, $startDate, $endDate)]);
    }

    /* ─── Load supporting data ─── */
    // Attendance records in range
    $attRecords = findMany(collection('attendance'), [
        'employee_id' => $empId,
        'date'        => ['$gte' => $startDate, '$lte' => $endDate],
    ], ['sort' => ['date' => 1]]);
    $attByDate = [];
    foreach ($attRecords as $r) {
        $attByDate[$r['date']] = $r;
    }

    // Holidays in range
    $holidays = findMany(collection('holidays'), [
        'date' => ['$gte' => $startDate, '$lte' => $endDate],
    ]);
    $holidayByDate = [];
    foreach ($holidays as $h) {
        $holidayByDate[$h['date']] = (string)($h['title'] ?? 'Holiday');
    }

    /* ─── Saturday rules ─
     * 1st & 2nd Saturday of each month = week off
     * 3rd & 4th Saturday = working day
     * 5th Saturday = week off
     * Sunday = always week off
     ─── */
    $rows    = [];
    $summary = ['present' => 0, 'absent' => 0, 'late' => 0, 'week_off' => 0, 'holiday' => 0, 'working_days' => 0, 'worked_off_day' => 0];

    $cursor = new DateTime($startDate);
    $end    = new DateTime($endDate);

    while ($cursor <= $end) {
        $d      = $cursor->format('Y-m-d');
        $dow    = (int)$cursor->format('N'); // 1=Mon … 7=Sun
        /* ── Determine day type ── */
        $scheduledType = 'work';
        $specialLabel = '';

        if ($dow === 7) {
            // Sunday — always off
            $scheduledType = 'week_off';
            $specialLabel = 'Week Off (Sunday)';
        } elseif ($dow === 6) {
            // Saturday - 1st, 2nd, and 5th are off; 3rd and 4th are working.
            $saturdayCount = saturdayNumberInMonth($cursor);
            if ($saturdayCount !== 3 && $saturdayCount !== 4) {
                $scheduledType = 'week_off';
                $specialLabel = 'Week Off (' . ordinal($saturdayCount) . ' Saturday)';
            }
        }

        // Holidays override week_off if HR set a holiday on that day
        if (isset($holidayByDate[$d])) {
            $scheduledType = 'holiday';
            $specialLabel = $holidayByDate[$d];
        }

        /* ── Build row from attendance record ── */
        $rec = $attByDate[$d] ?? null;
        $hasWorkedRecord = $rec && !empty($rec['check_in']) && (($rec['status'] ?? '') !== 'absent');
        $workedOffDay = $hasWorkedRecord && in_array($scheduledType, ['week_off', 'holiday'], true);

        $rowType = $workedOffDay ? 'work' : $scheduledType;
        if ($rowType === 'work' && !$rec) {
            // Do not record an employee as absent while today's attendance
            // window is still in progress. Historical working days remain
            // absent until HR adds or corrects an attendance record.
            $rowType = $d === $today ? 'pending' : 'absent';
        }

        $checkIn  = null;
        $checkOut = null;
        $netHours = null;
        $task     = null;
        $taskStatus = null;
        $lateMinutes = 0;
        $status   = $rowType;

        if ($rec) {
            $checkIn  = $rec['check_in']  ? substr((string)$rec['check_in'], 0, 5)  : null;
            $checkOut = $rec['check_out'] ? substr((string)$rec['check_out'], 0, 5) : null;
            $netHours = $rec['working_hours'] ?? $rec['net_working_hours'] ?? null;
            $task     = $rec['daily_task_update'] ?? null;
            $lateMinutes = (int)($rec['late_minutes'] ?? 0);
            $status   = (string)($rec['status'] ?? $rowType);

            // Task status: past days without a status → auto completed
            $savedStatus = $rec['task_status'] ?? null;
            if ($savedStatus) {
                $taskStatus = $savedStatus;
            } elseif ($d < $today && $task) {
                $taskStatus = 'completed'; // past day with task → completed
            } elseif ($task) {
                $taskStatus = 'pending';   // today or future with task → pending
            }
        }

        /* ── Summary counts ── */
        switch ($rowType) {
            case 'work':
                if ($workedOffDay) {
                    $summary['worked_off_day']++;
                } else {
                    $summary['working_days']++;
                }
                if ($status === 'present')        $summary['present']++;
                elseif ($status === 'late')        { $summary['present']++; $summary['late']++; }
                elseif ($status === 'absent')      $summary['absent']++;
                elseif ($status === 'early_checkout') $summary['present']++;
                elseif ($status === 'half_day')    $summary['present']++;
                break;
            case 'absent':
                $summary['working_days']++;
                $summary['absent']++;
                break;
            case 'pending':
                $summary['working_days']++;
                break;
            case 'week_off':
                $summary['week_off']++;
                break;
            case 'holiday':
                $summary['holiday']++;
                break;
        }

        $mode = $rec ? (string)($rec['mode'] ?? 'office') : null;
        
        $rows[] = [
            'date'         => $d,
            'day_name'     => $cursor->format('D'), // Mon, Tue...
            'day_number'   => $dow,
            'row_type'     => $rowType,
            'special_label'=> $specialLabel,
            'scheduled_type'=> $scheduledType,
            'worked_off_day'=> $workedOffDay,
            'check_in'     => $checkIn,
            'check_out'    => $checkOut,
            'working_hours'=> $netHours,
            'mode'         => $mode,
            'task'         => $task,
            'task_status'  => $taskStatus,
            'late_minutes' => $lateMinutes,
            'status'       => $status,
            'source'       => $rec ? (string)($rec['source'] ?? ($rec['checkin_device'] === 'Biometric' ? 'biometric' : 'manual')) : null,
        ];

        $cursor->modify('+1 day');
    }

    $empName = $empDoc['name'] ?? 'Unknown';
    $empCode = $empDoc['employee_code'] ?? '';
    $dept    = $empDoc['department'] ?? '';

    $payload = [
        'employee' => [
            'id'            => $empId,
            'name'          => $empName,
            'employee_code' => $empCode,
            'department'    => $dept,
        ],
        'range'   => ['from' => $startDate, 'to' => $endDate],
        'summary' => $summary,
        'rows'    => $rows,
    ];

    if (!empty($_GET['download'])) {
        outputDailyWorkUpdateXlsx($payload);
    }

    ok($payload);
}

fail('Method not allowed.', 405);

/* ─── Helpers ─── */

function saturdayNumberInMonth(DateTime $date): int
{
    $month = (int)$date->format('m');
    $year  = (int)$date->format('Y');
    $day   = (int)$date->format('j');

    $count = 0;
    for ($d = 1; $d <= $day; $d++) {
        $ts = mktime(0, 0, 0, $month, $d, $year);
        if ((int)date('N', $ts) === 6) $count++;
    }
    return $count;
}

function ordinal(int $number): string
{
    if ($number === 1) return '1st';
    if ($number === 2) return '2nd';
    if ($number === 3) return '3rd';
    return $number . 'th';
}

function emptySummary(array $empDoc, string $from, string $to): array
{
    return [
        'employee' => [
            'id'            => (string)($empDoc['_id'] ?? $empDoc['id'] ?? ''),
            'name'          => $empDoc['name'] ?? '',
            'employee_code' => $empDoc['employee_code'] ?? '',
            'department'    => $empDoc['department'] ?? '',
        ],
        'range'   => ['from' => $from, 'to' => $to],
        'summary' => ['present' => 0, 'absent' => 0, 'late' => 0, 'week_off' => 0, 'holiday' => 0, 'working_days' => 0, 'worked_off_day' => 0],
        'rows'    => [],
    ];
}

function xmlText(?string $value): string
{
    return htmlspecialchars((string)$value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
}

function colName(int $index): string
{
    $name = '';
    while ($index > 0) {
        $index--;
        $name = chr(65 + ($index % 26)) . $name;
        $index = intdiv($index, 26);
    }
    return $name;
}

function xlsxCell(string $ref, ?string $value, int $style = 0): string
{
    $safe = xmlText($value ?? '');
    return '<c r="' . $ref . '" t="inlineStr" s="' . $style . '"><is><t xml:space="preserve">' . $safe . '</t></is></c>';
}

function xlsxRow(int $rowNumber, array $values, int $style = 0, array $styleByColumn = []): string
{
    $cells = '';
    foreach ($values as $idx => $value) {
        $col = $idx + 1;
        $cells .= xlsxCell(colName($col) . $rowNumber, $value, $styleByColumn[$col] ?? $style);
    }
    return '<row r="' . $rowNumber . '">' . $cells . '</row>';
}

function dailyWorkStatusLabel(array $row): string
{
    if (!empty($row['worked_off_day'])) return 'Present (Worked Off Day)';
    if (($row['row_type'] ?? '') === 'week_off') return 'Week Off';
    if (($row['row_type'] ?? '') === 'holiday') return 'Holiday';
    if (($row['row_type'] ?? '') === 'absent') return 'Absent';
    $status = (string)($row['status'] ?? 'present');
    if ($status === 'late') {
        return 'Present';
    }
    return ucwords(str_replace('_', ' ', $status));
}

function outputDailyWorkUpdateXlsx(array $payload): void
{
    if (!class_exists('ZipArchive')) {
        fail('Excel export is not available on this server.', 500);
    }

    $employee = $payload['employee'] ?? [];
    $rows = $payload['rows'] ?? [];
    $range = $payload['range'] ?? [];
    $employeeName = (string)($employee['name'] ?? 'Employee');
    $title = trim($employeeName . ' Daily Work Update ' . ($range['from'] ?? '') . ' to ' . ($range['to'] ?? ''));
    $safeName = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '_', $employeeName), '_')) ?: 'employee';
    $filename = $safeName . '_daily_work_update_' . (($range['from'] ?? date('Y-m-d')) . '_to_' . ($range['to'] ?? date('Y-m-d'))) . '.xlsx';

    $sheetRows = [];
    $sheetRows[] = xlsxRow(1, [$title, '', '', '', '', '', '', '', ''], 1);
    $sheetRows[] = '<row r="2"></row>';
    $sheetRows[] = xlsxRow(3, [
        'Date', 'Day', 'Log-in Time', 'Log-out Time', 'Working Hours', 'Mode',
        'Work Update', 'Work Status', 'Late Minutes', 'Attendance Status'
    ], 2);

    $r = 4;
    foreach ($rows as $row) {
        $rowType = (string)($row['row_type'] ?? '');
        $style = 3;
        if (!empty($row['worked_off_day'])) $style = 7;
        elseif ($rowType === 'absent') $style = 4;
        elseif ($rowType === 'week_off') $style = 5;
        elseif ($rowType === 'holiday') $style = 6;

        $isOffOnly = in_array($rowType, ['week_off', 'holiday'], true);
        $modeLabel = $row['mode'] ?? null;
        if ($modeLabel === 'wfh') {
            $modeLabel = 'WFH';
        } elseif ($modeLabel === 'office') {
            $modeLabel = 'Office';
        } else {
            $modeLabel = '-';
        }
        
        $sheetRows[] = xlsxRow($r, [
            (string)($row['date'] ?? ''),
            (string)($row['day_name'] ?? ''),
            $isOffOnly ? (string)($row['special_label'] ?? dailyWorkStatusLabel($row)) : ((string)($row['check_in'] ?? '') ?: '-'),
            $isOffOnly ? '' : ((string)($row['check_out'] ?? '') ?: '-'),
            (string)($row['working_hours'] ?? ''),
            $modeLabel,
            (string)($row['task'] ?? ($rowType === 'absent' ? 'Absent' : '')),
            (string)($row['task_status'] ?? ''),
            (string)($row['late_minutes'] ?? ''),
            dailyWorkStatusLabel($row),
        ], $style);
        $r++;
    }

    $sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        . '<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="10" customWidth="1"/><col min="3" max="5" width="16" customWidth="1"/><col min="6" max="6" width="12" customWidth="1"/><col min="7" max="7" width="48" customWidth="1"/><col min="8" max="10" width="18" customWidth="1"/></cols>'
        . '<sheetData>' . implode('', $sheetRows) . '</sheetData>'
        . '<mergeCells count="1"><mergeCell ref="A1:J1"/></mergeCells>'
        . '</worksheet>';

    $stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/></font></fonts>'
        . '<fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF97316"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF111827"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDECEC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF7E6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF7EF"/></patternFill></fill></fills>'
        . '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE5E7EB"/></left><right style="thin"><color rgb="FFE5E7EB"/></right><top style="thin"><color rgb="FFE5E7EB"/></top><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border></borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        . '<cellXfs count="28">'
        . '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        . '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        . '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
        . '<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        . '<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        . '<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        . '<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        . '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        . str_repeat('<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>', 5)
        . str_repeat('<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>', 15)
        . '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    $tmp = tempnam(sys_get_temp_dir(), 'daily_work_update_');
    if ($tmp === false) fail('Unable to create Excel file.', 500);

    $zip = new ZipArchive();
    if ($zip->open($tmp, ZipArchive::OVERWRITE) !== true) {
        @unlink($tmp);
        fail('Unable to create Excel file.', 500);
    }

    $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Daily Work Update" sheetId="1" r:id="rId1"/></sheets></workbook>');
    $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    $zip->addFromString('xl/styles.xml', $stylesXml);
    $zip->addFromString('xl/worksheets/sheet1.xml', $sheetXml);
    $zip->close();

    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . filesize($tmp));
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    readfile($tmp);
    @unlink($tmp);
    exit;
}
