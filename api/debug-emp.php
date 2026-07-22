<?php
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/mongodb-helpers.php';

$emp = findOne(collection('employees'), []);
if ($emp) {
    echo "First employee joining_date type: " . gettype($emp['joining_date']) . "\n";
    echo "Value: " . var_export($emp['joining_date'], true) . "\n";
    
    if ($emp['joining_date'] instanceof MongoDB\BSON\UTCDateTime) {
        echo "Is UTCDateTime: YES\n";
    } else {
        echo "Is UTCDateTime: NO\n";
    }
    
    if (is_array($emp['joining_date'])) {
        echo "Is array: YES\n";
        echo "Array keys: " . implode(', ', array_keys($emp['joining_date'])) . "\n";
    }
}
?>
