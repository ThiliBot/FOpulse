// src/controllers/trigger.controller.js
const triggerService = require('../services/trigger.service');
const OptionTrigger = require('../models/OptionTrigger');
const { NIFTY50_SYMBOLS } = require('../config/symbols');

/** Public market-data delay (days). Only data OLDER than this is exposed. */
const DELAY_DAYS = 30;

function startOfDayIST(yyyyMmDd) {
  return new Date(`${yyyyMmDd}T00:00:00+05:30`);
}

function endOfDayIST(yyyyMmDd) {
  return new Date(`${yyyyMmDd}T23:59:59.999+05:30`);
}

function daysAgoDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Event must be at or before cutoff (older than DELAY_DAYS). */
function olderThanDelayFilter(cutoff) {
  return {
    $or: [
      { triggerEndTime: { $lte: cutoff, $ne: null } },
      {
        $and: [
          {
            $or: [
              { triggerEndTime: null },
              { triggerEndTime: { $exists: false } }
            ]
          },
          { generatedTime: { $lte: cutoff } }
        ]
      }
    ]
  };
}

/**
 * POST /api/test/run-triggers
 * Body (optional): { "symbols": ["INFY", "TCS"] }
 */
async function runTriggers(req, res) {
  try {
    const symbols = req.body?.symbols?.length
      ? req.body.symbols
      : NIFTY50_SYMBOLS;

    console.log('🚀 Starting trigger job for:', symbols);

    res.json({
      status: true,
      message: 'Trigger job started. Check PM2 logs / dashboard later.'
    });

    triggerService.runTriggerJob(symbols).catch((err) => {
      console.error('Background trigger job failed:', err.message);
    });
  } catch (err) {
    console.error('Trigger test failed:', err);
    return res.status(500).json({
      status: false,
      message: err.message || 'Trigger job failed'
    });
  }
}

/**
 * GET /api/triggers/dates
 * Public: only days older than DELAY_DAYS
 */
async function getTriggerDates(req, res) {
  try {
    const minChange = Number(req.query.minChange) || 5;
    const cutoff = daysAgoDate(DELAY_DAYS);

    const rows = await OptionTrigger.aggregate([
      {
        $match: {
          $and: [
            {
              $or: [
                { changePercent: { $gte: minChange } },
                { changePercent: { $lte: -minChange } }
              ]
            },
            olderThanDelayFilter(cutoff)
          ]
        }
      },
      {
        $project: {
          day: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: { $ifNull: ['$triggerEndTime', '$generatedTime'] },
              timezone: 'Asia/Kolkata'
            }
          }
        }
      },
      { $group: { _id: '$day', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 90 }
    ]);

    return res.json({
      status: true,
      delayDays: DELAY_DAYS,
      message: `Public data delayed by ${DELAY_DAYS} days`,
      dates: rows.map((r) => ({ date: r._id, count: r.count }))
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
}

/**
 * GET /api/triggers
 * Query: minChange, limit, page, date (YYYY-MM-DD)
 * Public: only data older than DELAY_DAYS
 */
async function getTriggers(req, res) {
  try {
    const minChange = Number(req.query.minChange) || 5;
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const date = req.query.date || null;
    const skip = (page - 1) * limit;
    const cutoff = daysAgoDate(DELAY_DAYS);

    const filter = {
      $and: [
        {
          $or: [
            { changePercent: { $gte: minChange } },
            { changePercent: { $lte: -minChange } }
          ]
        },
        olderThanDelayFilter(cutoff)
      ]
    };

    if (date) {
      const dateEnd = endOfDayIST(date);

      // Day still inside regulatory window → empty
      if (dateEnd > cutoff) {
        return res.json({
          status: true,
          count: 0,
          total: 0,
          page,
          limit,
          date,
          delayDays: DELAY_DAYS,
          data: [],
          message: `Date is within ${DELAY_DAYS}-day regulatory delay`
        });
      }

      filter.$and.push({
        $or: [
          {
            triggerEndTime: {
              $gte: startOfDayIST(date),
              $lte: endOfDayIST(date)
            }
          },
          {
            $and: [
              {
                $or: [
                  { triggerEndTime: null },
                  { triggerEndTime: { $exists: false } }
                ]
              },
              {
                generatedTime: {
                  $gte: startOfDayIST(date),
                  $lte: endOfDayIST(date)
                }
              }
            ]
          }
        ]
      });
    }

    const [triggers, total] = await Promise.all([
      OptionTrigger.find(filter)
        .sort({ changePercent: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      OptionTrigger.countDocuments(filter)
    ]);

    return res.json({
      status: true,
      count: triggers.length,
      total,
      page,
      limit,
      date,
      delayDays: DELAY_DAYS,
      data: triggers
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
}

/**
 * GET /api/admin/triggers/dates
 * No SEBI delay — all days in DB
 */
async function getTriggerDatesAdmin(req, res) {
  try {
    const minChange = Number(req.query.minChange) || 5;

    const rows = await OptionTrigger.aggregate([
      {
        $match: {
          $or: [
            { changePercent: { $gte: minChange } },
            { changePercent: { $lte: -minChange } }
          ]
        }
      },
      {
        $project: {
          day: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: { $ifNull: ['$triggerEndTime', '$generatedTime'] },
              timezone: 'Asia/Kolkata'
            }
          }
        }
      },
      { $group: { _id: '$day', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 90 }
    ]);

    return res.json({
      status: true,
      admin: true,
      dates: rows.map((r) => ({ date: r._id, count: r.count }))
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
}

/**
 * GET /api/admin/triggers
 * No SEBI delay
 */
async function getTriggersAdmin(req, res) {
  try {
    const minChange = Number(req.query.minChange) || 5;
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const date = req.query.date || null;
    const skip = (page - 1) * limit;

    const filter = {
      $or: [
        { changePercent: { $gte: minChange } },
        { changePercent: { $lte: -minChange } }
      ]
    };

    if (date) {
      filter.$and = [
        {
          $or: [
            {
              triggerEndTime: {
                $gte: startOfDayIST(date),
                $lte: endOfDayIST(date)
              }
            },
            {
              $and: [
                {
                  $or: [
                    { triggerEndTime: null },
                    { triggerEndTime: { $exists: false } }
                  ]
                },
                {
                  generatedTime: {
                    $gte: startOfDayIST(date),
                    $lte: endOfDayIST(date)
                  }
                }
              ]
            }
          ]
        }
      ];
    }

    const [triggers, total] = await Promise.all([
      OptionTrigger.find(filter)
        .sort({ changePercent: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      OptionTrigger.countDocuments(filter)
    ]);

    return res.json({
      status: true,
      admin: true,
      count: triggers.length,
      total,
      page,
      limit,
      date,
      data: triggers
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
}

module.exports = {
  runTriggers,
  getTriggers,
  getTriggerDates,
  getTriggersAdmin,
  getTriggerDatesAdmin
};