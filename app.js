const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const errorHandler = require('./middleware/error.middleware');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const branchRoutes = require('./routes/branch.routes');
const patientRoutes = require('./routes/patient.routes');
const patientPaymentRoutes = require('./routes/patientPayment.routes');
const patientExpenseRoutes = require('./routes/patientExpense.routes');
const employeeRoutes = require('./routes/employee.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const advanceRoutes = require('./routes/advance.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const expenseRoutes = require('./routes/expense.routes');
const transactionRoutes = require('./routes/transaction.routes');
const reportRoutes = require('./routes/report.routes');
const auditLogRoutes = require('./routes/auditLog.routes');

const app = express();

// Body Parser & Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow origins listed in ALLOWED_ORIGINS env var (comma-separated)
// e.g. ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:3000
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'https://zat-clinic-system-admin.vercel.app', 'https://zat-clinic-system-frontend.vercel.app'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, true); // still allow — change to callback(new Error(...)) to strictly block
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(morgan('dev'));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/patient-payments', patientPaymentRoutes);
app.use('/api/patient-expenses', patientExpenseRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/advances', advanceRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit-logs', auditLogRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Clinic Management System API is running' });
});

// Centralized Error Handler
app.use(errorHandler);

module.exports = app;
