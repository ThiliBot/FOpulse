// src/models/OptionTrigger.js
const mongoose = require('mongoose');

const OptionTriggerSchema = new mongoose.Schema({
  instrumentName: {
    type: String,
    required: true,
    index: true
  },
  symbol: {
    type: String,
    required: true,
    index: true
  },
  instrumentSector: {
    type: String,
    required: true,
    index: true          // Nifty50, NiftyIT, NiftyAuto etc.
  },
  volume: {
    type: Number,
    default: 0
  },
  expiry: {
    type: String,
    required: true
  },
  strikePrice: {
    type: Number,
    required: true
  },
  optionType: {
    type: String,
    enum: ['CE', 'PE'],
    required: true,
    index: true
  },
  generatedTime: {
    type: Date,
    required: true,
    index: true
  },
  triggerStartTime: {
    type: Date,
    required: true
  },
  triggerEndTime: {
    type: Date,
    required: true
  },
  triggerStartPrice: {
    type: Number,
    required: true
  },
  triggerEndPrice: {
    type: Number,
    required: true
  },
  changePercent: {
    type: Number,
    required: true,
    index: true
  },
  priceSequence: {
    type: [Number],      // Array of 15 numbers
    required: true
  },
  token: String,
  lotSize: { type: Number, default: 1 },
  underlyingPrice: Number,
  underlyingChangePct: Number,
  moneynessPct: Number,
  strikeOffset: Number,          // -2..+2 from ATM
  dte: Number,
  oi: Number,
  bid: Number,
  ask: Number,
  spreadPct: Number,
  totBuyQuan: Number,
  totSellQuan: Number,
  dayOpen: Number,
  dayHigh: Number,
  dayLow: Number,
  iv: Number,
  delta: Number,
  gamma: Number,
  theta: Number,
  vega: Number,
  windowHigh: Number,
  windowLow: Number,
  sessionDate: String,           // YYYY-MM-DD IST
  windowIndex: Number            // 0 = 09:15, 1 = 09:30, ...
}, {
  timestamps: true       // adds createdAt & updatedAt automatically
});

// Compound indexes for common queries
OptionTriggerSchema.index({ generatedTime: -1, instrumentSector: 1 });
OptionTriggerSchema.index({ symbol: 1, generatedTime: -1 });
OptionTriggerSchema.index({ changePercent: -1 });

module.exports = mongoose.model('OptionTrigger', OptionTriggerSchema);