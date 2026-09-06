const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    entryDate: { type: Date, required: true, default: Date.now },
    exitDate: { type: Date, default: null },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    accommodationAmount: { type: Number, default: 0, min: 0 },
    expenseDeposit: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['current', 'discharged'], default: 'current' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Patient', patientSchema);
