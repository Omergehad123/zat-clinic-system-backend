const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const { logAudit } = require('../utils/audit.utils');

// GET /api/invoices
const getInvoices = async (req, res, next) => {
  try {
    const filter = { ...req.branchFilter };

    if (req.query.month && req.query.year) {
      const m = parseInt(req.query.month) - 1;
      const y = parseInt(req.query.year);
      const startOfMonth = new Date(y, m, 1);
      const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);
      filter.date = { $gte: startOfMonth, $lte: endOfMonth };
    }

    const invoices = await Invoice.find(filter).populate('createdBy', 'name').sort({ date: -1 });

    const formatted = invoices.map(inv => ({
      id: inv._id.toString(),
      _id: inv._id.toString(),
      invoiceNumber: inv.invoiceNumber,
      branchId: inv.branchId.toString(),
      date: inv.date,
      category: inv.category || 'مستلزمات',
      items: (inv.items || []).map(item => ({
        id: item._id ? item._id.toString() : undefined,
        name: item.itemName || item.name || 'بند',
        itemName: item.itemName || item.name || 'بند',
        count: item.quantity ?? item.count ?? 1,
        quantity: item.quantity ?? item.count ?? 1,
        price: item.unitPrice ?? item.price ?? 0,
        unitPrice: item.unitPrice ?? item.price ?? 0,
        total: item.total || 0
      })),
      totalAmount: inv.totalAmount,
      notes: inv.notes,
      createdBy: inv.createdBy ? inv.createdBy.name : ''
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

// POST /api/invoices
const createInvoice = async (req, res, next) => {
  try {
    const { invoiceNumber, category, items, date, notes, branchId } = req.body;

    const targetBranchId = req.user.role === 'super_admin' ? (branchId || req.body.branchId) : req.user.branchId;

    if (!targetBranchId) {
      return res.status(400).json({ success: false, message: 'معرف الفرع مطلوب' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'يجب إضافة بند واحد على الأقل في الفاتورة' });
    }

    // SERVER-SIDE CALCULATION VALIDATION
    let calculatedTotal = 0;
    const validatedItems = items.map((item) => {
      const itemName = item.itemName || item.name || 'بند';
      const quantity = Math.max(1, Number(item.quantity ?? item.count) || 1);
      const unitPrice = Math.max(0, Number(item.unitPrice ?? item.price) || 0);
      const itemTotal = quantity * unitPrice;
      calculatedTotal += itemTotal;

      return {
        itemName,
        quantity,
        unitPrice,
        total: itemTotal
      };
    });

    const generatedInvNum = invoiceNumber || `INV-${Date.now().toString().slice(-6)}`;

    const invoice = await Invoice.create({
      invoiceNumber: generatedInvNum,
      branchId: targetBranchId,
      category: category || 'مستلزمات',
      date: date || Date.now(),
      items: validatedItems,
      totalAmount: calculatedTotal,
      notes: notes || '',
      createdBy: req.user._id
    });

    // Auto-create transaction for invoice expense
    await Transaction.create({
      type: 'expense',
      amount: calculatedTotal,
      date: invoice.date,
      category: category || 'Supplies',
      description: `فاتورة مصروفات رقم #${invoice.invoiceNumber} (${category || 'مستلزمات'})`,
      branchId: targetBranchId,
      invoiceId: invoice._id,
      createdBy: req.user._id
    });

    await logAudit({
      user: req.user,
      action: 'CREATE_INVOICE',
      entity: 'Invoice',
      entityId: invoice._id,
      branchId: targetBranchId,
      metadata: { invoiceNumber: invoice.invoiceNumber, totalAmount: calculatedTotal }
    });

    res.status(201).json({
      success: true,
      data: {
        id: invoice._id.toString(),
        _id: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
        branchId: invoice.branchId.toString(),
        date: invoice.date,
        items: invoice.items,
        totalAmount: invoice.totalAmount,
        notes: invoice.notes
      }
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/invoices/:id
const updateInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { items, date, notes, category } = req.body;

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
    }

    if (req.user.role !== 'super_admin' && invoice.branchId.toString() !== req.user.branchId.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بتعديل هذه الفاتورة' });
    }

    if (items && Array.isArray(items) && items.length > 0) {
      let calculatedTotal = 0;
      const validatedItems = items.map((item) => {
        const itemName = item.itemName || item.name || 'بند';
        const quantity = Math.max(1, Number(item.quantity ?? item.count) || 1);
        const unitPrice = Math.max(0, Number(item.unitPrice ?? item.price) || 0);
        const itemTotal = quantity * unitPrice;
        calculatedTotal += itemTotal;

        return {
          itemName,
          quantity,
          unitPrice,
          total: itemTotal
        };
      });

      invoice.items = validatedItems;
      invoice.totalAmount = calculatedTotal;
    }

    if (category) invoice.category = category;
    if (date) invoice.date = date;
    if (notes !== undefined) invoice.notes = notes;

    await invoice.save();

    // Sync updated transaction
    await Transaction.findOneAndUpdate(
      { invoiceId: invoice._id },
      {
        amount: invoice.totalAmount,
        date: invoice.date,
        category: invoice.category || 'Supplies',
        description: `فاتورة مصروفات رقم #${invoice.invoiceNumber} (${invoice.category || 'مستلزمات'})`
      }
    );

    await logAudit({
      user: req.user,
      action: 'UPDATE_INVOICE',
      entity: 'Invoice',
      entityId: invoice._id,
      branchId: invoice.branchId,
      metadata: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount }
    });

    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/invoices/:id
const deleteInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id);

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
    }

    if (req.user.role !== 'super_admin' && invoice.branchId.toString() !== req.user.branchId.toString()) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بحذف هذه الفاتورة' });
    }

    await Transaction.deleteMany({ invoiceId: invoice._id });
    await invoice.deleteOne();

    await logAudit({
      user: req.user,
      action: 'DELETE_INVOICE',
      entity: 'Invoice',
      entityId: id,
      branchId: invoice.branchId
    });

    res.json({ success: true, message: 'تم حذف الفاتورة بنجاح' });
  } catch (error) {
    next(error);
  }
};

module.exports = { getInvoices, createInvoice, updateInvoice, deleteInvoice };
