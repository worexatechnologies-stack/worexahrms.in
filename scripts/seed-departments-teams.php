<?php
/**
 * Seed initial departments and teams
 * Run: php scripts/seed-departments-teams.php
 */
declare(strict_types=1);

require_once __DIR__ . '/../api/config/bootstrap.php';
require_once __DIR__ . '/../api/config/mongodb-helpers.php';

echo "🌱 Seeding Departments & Teams...\n\n";

$depts = collection('departments');
$teams = collection('teams');

// Check if already seeded
$existingCount = countDocs($depts, []);
if ($existingCount > 0) {
    echo "⚠️  Found {$existingCount} existing departments. Skipping seed.\n";
    echo "💡 To re-seed, delete all departments first from the UI or run:\n";
    echo "   db.departments.deleteMany({})\n";
    exit(0);
}

// Define departments with colors
$departmentData = [
    ['name' => 'IT', 'description' => 'Information Technology', 'color' => '#3b82f6'],
    ['name' => 'HR', 'description' => 'Human Resources', 'color' => '#10b981'],
    ['name' => 'Social Media', 'description' => 'Social Media Marketing', 'color' => '#ec4899'],
    ['name' => 'BBE', 'description' => 'Business & Brand Excellence', 'color' => '#f59e0b'],
    ['name' => 'Accounting', 'description' => 'Finance & Accounting', 'color' => '#6366f1'],
    ['name' => 'Sales', 'description' => 'Sales & Business Development', 'color' => '#ef4444'],
    ['name' => 'SEO', 'description' => 'Search Engine Optimization', 'color' => '#14b8a6'],
    ['name' => 'Performance Marketing', 'description' => 'Performance Marketing & Analytics', 'color' => '#8b5cf6'],
];

// Define teams
$teamData = [
    ['name' => 'Backend Team', 'description' => 'Server-side development', 'department' => 'IT'],
    ['name' => 'Frontend Team', 'description' => 'UI/UX development', 'department' => 'IT'],
    ['name' => 'DevOps Team', 'description' => 'Infrastructure & deployment', 'department' => 'IT'],
    ['name' => 'Recruitment', 'description' => 'Talent acquisition', 'department' => 'HR'],
    ['name' => 'Content Creators', 'description' => 'Social media content', 'department' => 'Social Media'],
    ['name' => 'SEO Specialists', 'description' => 'Organic search optimization', 'department' => 'SEO'],
];

echo "📦 Creating Departments...\n";
foreach ($departmentData as $dept) {
    try {
        insertOne($depts, [
            'name' => $dept['name'],
            'description' => $dept['description'],
            'color' => $dept['color'],
            'created_at' => new MongoDB\BSON\UTCDateTime(),
            'updated_at' => new MongoDB\BSON\UTCDateTime(),
        ]);
        echo "  ✅ {$dept['name']}\n";
    } catch (Exception $e) {
        echo "  ❌ {$dept['name']}: {$e->getMessage()}\n";
    }
}

echo "\n📦 Creating Teams...\n";
foreach ($teamData as $team) {
    try {
        insertOne($teams, [
            'name' => $team['name'],
            'description' => $team['description'],
            'department' => $team['department'],
            'team_lead_id' => null,
            'member_ids' => [],
            'created_at' => new MongoDB\BSON\UTCDateTime(),
            'updated_at' => new MongoDB\BSON\UTCDateTime(),
        ]);
        echo "  ✅ {$team['name']} ({$team['department']})\n";
    } catch (Exception $e) {
        echo "  ❌ {$team['name']}: {$e->getMessage()}\n";
    }
}

echo "\n✨ Seeding complete!\n";
echo "🎉 You can now visit the Departments page to manage them.\n";
