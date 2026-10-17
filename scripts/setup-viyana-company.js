#!/usr/bin/env node

/**
 * setup-viyana-company.js
 * Initializes Viyana Production company database and records in MongoDB.
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://ullasgowdaworexa_db_user:CKNINKHTuKzoZbRM@cluster0.4ptj6i3.mongodb.net';

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB cluster');

    const masterDb = client.db('hrms');
    const viyanaDb = client.db('hrms_viyana');

    // 1. Setup companies registry in hrms master DB
    const companiesCol = masterDb.collection('companies');
    await companiesCol.createIndex({ slug: 1 }, { unique: true });

    await companiesCol.updateOne(
      { slug: 'worexa' },
      {
        $set: {
          slug: 'worexa',
          name: 'Worexa',
          db_name: 'hrms',
          active: true,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
    console.log('✓ Registered Worexa in companies collection');

    await companiesCol.updateOne(
      { slug: 'viyana' },
      {
        $set: {
          slug: 'viyana',
          name: 'Viyana Production',
          db_name: 'hrms_viyana',
          active: true,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
    console.log('✓ Registered Viyana Production in companies collection');

    // 2. Setup Viyana Admin in hrms_viyana.users
    const viyanaUsers = viyanaDb.collection('users');
    await viyanaUsers.createIndex({ email: 1 }, { unique: true });

    // Bcrypt hash of "Viyana@2026!"
    const adminEmail = 'admin@viyana.com';
    const passwordHash = '$2y$12$JH6FpBIyo7TNwueN0IGrFuT0PYnXqpgfmL0xBNi7NLe1HzRvh6wO6';

    const existingAdmin = await viyanaUsers.findOne({ email: adminEmail });
    if (existingAdmin) {
      await viyanaUsers.updateOne(
        { _id: existingAdmin._id },
        {
          $set: {
            name: 'Viyana Admin',
            password: passwordHash,
            role: 'hr',
            company_name: 'Viyana Production',
            company_slug: 'viyana',
            updated_at: new Date(),
          },
        }
      );
      console.log(`✓ Updated existing Viyana admin: ${adminEmail}`);
    } else {
      await viyanaUsers.insertOne({
        name: 'Viyana Admin',
        email: adminEmail,
        password: passwordHash,
        role: 'hr',
        company_name: 'Viyana Production',
        company_slug: 'viyana',
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log(`✓ Created Viyana admin: ${adminEmail}`);
    }

    // 3. Copy standard attendance_settings from hrms if not yet present in viyanaDb
    const viyanaSettingsCol = viyanaDb.collection('attendance_settings');
    const settingsCount = await viyanaSettingsCol.countDocuments();
    if (settingsCount === 0) {
      const defaultSettings = await masterDb.collection('attendance_settings').find({}).toArray();
      if (defaultSettings.length > 0) {
        const cleanSettings = defaultSettings.map(s => {
          const { _id, ...rest } = s;
          return { ...rest, _id: new ObjectId() };
        });
        await viyanaSettingsCol.insertMany(cleanSettings);
        console.log(`✓ Copied ${cleanSettings.length} attendance settings to hrms_viyana`);
      }
    } else {
      console.log(`✓ hrms_viyana already has ${settingsCount} attendance settings`);
    }

    // 4. Copy standard holidays from hrms if not yet present in viyanaDb
    const viyanaHolidaysCol = viyanaDb.collection('holidays');
    const holidaysCount = await viyanaHolidaysCol.countDocuments();
    if (holidaysCount === 0) {
      const defaultHolidays = await masterDb.collection('holidays').find({}).toArray();
      if (defaultHolidays.length > 0) {
        const cleanHolidays = defaultHolidays.map(h => {
          const { _id, ...rest } = h;
          return { ...rest, _id: new ObjectId() };
        });
        await viyanaHolidaysCol.insertMany(cleanHolidays);
        console.log(`✓ Copied ${cleanHolidays.length} holidays to hrms_viyana`);
      }
    } else {
      console.log(`✓ hrms_viyana already has ${holidaysCount} holidays`);
    }

    // 5. Setup essential indexes on hrms_viyana collections
    await viyanaDb.collection('employees').createIndex({ email: 1 });
    await viyanaDb.collection('employees').createIndex({ employee_code: 1 });
    await viyanaDb.collection('attendance').createIndex({ employee_id: 1, date: 1 });
    await viyanaDb.collection('payroll').createIndex({ employee_id: 1, month: 1, year: 1 });
    await viyanaDb.collection('leaves').createIndex({ employee_id: 1, status: 1 });
    await viyanaDb.collection('notifications').createIndex({ user_id: 1, created_at: -1 });

    console.log('✓ Created indexes in hrms_viyana collections');
    console.log('\n--- Setup Complete ---');
    console.log('Company: Viyana Production');
    console.log('Database: hrms_viyana');
    console.log(`Email: ${adminEmail}`);
    console.log('Password: Viyana@2026!');
  } finally {
    await client.close();
  }
}

main().catch(console.error);
