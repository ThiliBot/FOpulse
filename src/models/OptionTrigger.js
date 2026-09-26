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
  }
}, {
  timestamps: true       // adds createdAt & updatedAt automatically
});

// Compound indexes for common queries
OptionTriggerSchema.index({ generatedTime: -1, instrumentSector: 1 });
OptionTriggerSchema.index({ symbol: 1, generatedTime: -1 });
OptionTriggerSchema.index({ changePercent: -1 });

module.exports = mongoose.model('OptionTrigger', OptionTriggerSchema);