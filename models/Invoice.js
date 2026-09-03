const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  itemName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true }
});

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    date: { type: Date, default: Date.now },
    category: { type: String, default: 'مستلزمات' },
    items: [invoiceItemSchema],
    totalAmount: { type: Number, required: true },
    notes: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Invoice', invoiceSchema);
