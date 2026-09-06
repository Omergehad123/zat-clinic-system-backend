/**
 * clearDatabase.js
 * Clears all collections from the database EXCEPT the super_admin user account.
 * Usage: node scripts/clearDatabase.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

async function clearDatabase() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB:', mongoose.connection.host);

    const db = mongoose.connection.db;

    // 1. Keep only super_admin users
    const usersCollection = db.collection('users');
    const adminUsers = await usersCollection.find({ role: 'super_admin' }).toArray();
    
    if (adminUsers.length === 0) {
      console.log('⚠️  WARNING: No super_admin account found! Aborting to prevent full wipe.');
      process.exit(1);
    }

    console.log(`\n👤 Found ${adminUsers.length} super_admin account(s) to preserve:`);
    adminUsers.forEach(u => console.log(`   - ${u.name} (${u.email})`));

    // Delete all non-super_admin users
    const deletedUsers = await usersCollection.deleteMany({ role: { $ne: 'super_admin' } });
    console.log(`\n🗑️  Deleted ${deletedUsers.deletedCount} non-admin user(s).`);

    // 2. Collections to fully clear
    const collectionsToClear = [
      'branches',
      'patients',
      'patientpayments',
      'patientexpenses',
      'employees',
      'employeeadvances',
      'attendances',
      'expenses',
      'invoices',
      'transactions',
      'auditlogs',
    ];

    console.log('\n🧹 Clearing all other collections...');
    for (const collName of collectionsToClear) {
      try {
        const col = db.collection(collName);
        const result = await col.deleteMany({});
        console.log(`   ✅ ${collName}: deleted ${result.deletedCount} document(s).`);
      } catch (err) {
        console.log(`   ⚠️  ${collName}: skipped (${err.message})`);
      }
    }

    console.log('\n✨ Database cleared successfully!');
    console.log('🔐 Super admin account(s) preserved.');
    console.log('\n📋 Preserved accounts:');
    adminUsers.forEach(u => {
      console.log(`   Email: ${u.email} | Name: ${u.name} | Status: ${u.status}`);
    });

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB.');
    process.exit(0);
  }
}

clearDatabase();
