const mongoose = require('mongoose');

const ScanRunSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true, index: true },
    finishedAt: { type: Date },
    status: {
      type: String,
      enum: ['running', 'success', 'failed', 'skipped'],
      default: 'running',
      index: true
    },
    symbolsCount: { type: Number, default: 0 },
    triggersFound: { type: Number, default: 0 },
    error: { type: String, default: null },
    dayIST: { type: String, index: true } // YYYY-MM-DD
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScanRun', ScanRunSchema);