#!/usr/bin/env node

/**
 * Import JSON backup files from latest-backup/ to local MongoDB
 * Usage: node import-backup-to-mongodb.js
 */

import fs from 'fs';
import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'hrms';
const BACKUP_DIR = path.join(__dirname, '../latest-backup');

const collections = [
  'attendance',
  'attendance_settings',
  'break_requests',
  'break_sessions',
  'chat_rooms',
  'chat_room_reads',
  'departments',
  'employees',
  'holidays',
  'leaves',
  'login_attempts',
  'notifications',
  'payroll',
  'payslips',
  'teams',
  'team_chat_messages',
  'users',
];

async function importBackup() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log(`✓ Connected to MongoDB at ${MONGODB_URI}`);

    const db = client.db(MONGODB_DB_NAME);
    console.log(`✓ Using database: ${MONGODB_DB_NAME}\n`);

    let totalImported = 0;

    for (const collectionName of collections) {
      const filePath = path.join(BACKUP_DIR, `${collectionName}.json`);

      if (!fs.existsSync(filePath)) {
        console.log(`⊘ File not found: ${collectionName}.json`);
        continue;
      }

      try {
        // Read JSON file
        const jsonData = fs.readFileSync(filePath, 'utf-8');
        const records = JSON.parse(jsonData);

        if (!Array.isArray(records) || records.length === 0) {
          console.log(`⊘ ${collectionName}: No records to import`);
          continue;
        }

        // Convert $oid format to ObjectId
        const convertedRecords = records.map((record) => {
          if (record._id && record._id.$oid) {
            record._id = ObjectId.createFromHexString(record._id.$oid);
          }
          return record;
        });

        // Drop existing collection
        try {
          await db.collection(collectionName).drop();
        } catch (e) {
          // Collection doesn't exist, that's fine
        }

        // Insert records
        const result = await db.collection(collectionName).insertMany(convertedRecords);

        console.log(`✓ ${collectionName}: ${result.insertedCount} records imported`);
        totalImported += result.insertedCount;
      } catch (error) {
        console.error(`✗ Error importing ${collectionName}:`, error.message);
      }
    }

    console.log(`\n✅ Import complete! Total records: ${totalImported}`);

    // Show summary
    console.log('\n📊 Database Summary:');
    for (const collectionName of collections) {
      try {
        const count = await db.collection(collectionName).countDocuments();
        if (count > 0) {
          console.log(`   ${collectionName}: ${count} records`);
        }
      } catch (e) {
        // Collection doesn't exist
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n✓ MongoDB connection closed');
  }
}

importBackup();
