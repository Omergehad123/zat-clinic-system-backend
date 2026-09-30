const mongoose = require('mongoose');

const timelineEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['entry', 'renewal', 'discharge', 'payment', 'expense', 'note', 'custom'],
      default: 'custom'
    },
    title: { type: String, required: true },
    date: { type: Date, default: Date.now },
    amount: { type: Number, default: 0 },
    details: { type: String, default: '' },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

const patientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    entryDate: { type: Date, required: true, default: Date.now },
    exitDate: { type: Date, default: null },
    lastRenewalDate: { type: Date, default: null },
    renewalsCount: { type: Number, default: 0 },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    accommodationAmount: { type: Number, default: 0, min: 0 },
    expenseDeposit: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['current', 'discharged'], default: 'current' },
    timeline: [timelineEventSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Patient', patientSchema);
