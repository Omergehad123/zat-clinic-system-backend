const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    date: { type: Date, default: Date.now },
    category: {
      type: String,
      required: true,
      enum: [
        'Food',
        'Medicine',
        'Utilities',
        'Maintenance',
        'Supplies',
        'Transportation',
        'Employee Advances',
        'Other'
      ],
      default: 'Other'
    },
    items: { type: mongoose.Schema.Types.Mixed, default: [] },
    totalAmount: { type: Number, required: true, min: 0 },
    notes: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Expense', expenseSchema);
