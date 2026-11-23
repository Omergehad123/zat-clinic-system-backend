const mongoose = require('mongoose');

const patientExpenseSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    date: { type: Date, default: Date.now },
    description: { type: String, default: '' },
    category: { type: String, default: 'Medicine' },
    amount: { type: Number, required: true, min: 0 },
    notes: { type: String, default: '' },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    timelineEventId: { type: mongoose.Schema.Types.ObjectId },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('PatientExpense', patientExpenseSchema);
