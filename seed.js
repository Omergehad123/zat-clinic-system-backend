const dotenv = require('dotenv');
dotenv.config();
const mongoose = require('mongoose');

const User = require('./models/User');
const Branch = require('./models/Branch');
const Patient = require('./models/Patient');
const PatientPayment = require('./models/PatientPayment');
const PatientExpense = require('./models/PatientExpense');
const Employee = require('./models/Employee');
const Attendance = require('./models/Attendance');
const EmployeeAdvance = require('./models/EmployeeAdvance');
const Expense = require('./models/Expense');
const Invoice = require('./models/Invoice');
const Transaction = require('./models/Transaction');
const AuditLog = require('./models/AuditLog');

const cleanAndSeedSuperAdminOnly = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected for clean seed...');

    // Delete all existing documents across all collections
    await Branch.deleteMany({});
    await User.deleteMany({});
    await Patient.deleteMany({});
    await PatientPayment.deleteMany({});
    await PatientExpense.deleteMany({});
    await Employee.deleteMany({});
    await Attendance.deleteMany({});
    await EmployeeAdvance.deleteMany({});
    await Expense.deleteMany({});
    await Invoice.deleteMany({});
    await Transaction.deleteMany({});
    await AuditLog.deleteMany({});

    console.log('All existing database records cleared.');

    // Create ONLY the Super Admin
    const superAdmin = await User.create({
      name: 'سوبر أدمن النظام',
      email: 'admin@clinic.com',
      password: 'AdminPassword123!',
      role: 'super_admin',
      branchId: null,
      status: 'active'
    });

    console.log('Super Admin created successfully!');
    console.log('-----------------------------------');
    console.log('Email: admin@clinic.com');
    console.log('Password: AdminPassword123!');
    console.log('Role: super_admin');
    console.log('-----------------------------------');
    console.log('Database is clean and ready for initial configuration by Super Admin.');

    process.exit(0);
  } catch (error) {
    console.error('Seeding Error:', error);
    process.exit(1);
  }
};

cleanAndSeedSuperAdminOnly();
