// GET /api/ops-status  (public)
const OptionTrigger = require('../models/OptionTrigger');
const ScanRun = require('../models/ScanRun');
const tokenService = require('../services/token.service');

async function getOpsStatus(req, res) {
  try {
    const tokens = tokenService.getAllTokens();
    let jwt = { valid: false, message: 'No active session' };
    if (tokens) {
      const remainingMs = tokens.expiresAt.getTime() - Date.now();
      const remainingSeconds = Math.max(0, Math.round(remainingMs / 1000));
      jwt = {
        valid: tokenService.hasValidToken(),
        expiresAt: tokens.expiresAt,
        remainingSeconds,
        minutesRemaining: Number((remainingSeconds / 60).toFixed(2)),
        hasRefreshToken: Boolean(tokens.refreshToken)
      };
    }

    const todayIST = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kolkata'
    });

    const scansToday = await ScanRun.find({ dayIST: todayIST })
      .sort({ startedAt: -1 })
      .lean();

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sectorDay = await OptionTrigger.aggregate([
      {
        $match: {
          $or: [
            { changePercent: { $gte: 5 } },
            { changePercent: { $lte: -5 } }
          ],
          $expr: {
            $gte: [{ $ifNull: ['$triggerEndTime', '$generatedTime'] }, since]
          }
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
          },
          sector: { $ifNull: ['$instrumentSector', 'Others'] }
        }
      },
      {
        $group: {
          _id: { day: '$day', sector: '$sector' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.day': -1, count: -1 } }
    ]);

    const byDay = {};
    sectorDay.forEach((r) => {
      const day = r._id.day;
      if (!byDay[day]) byDay[day] = { day, total: 0, sectors: {} };
      byDay[day].sectors[r._id.sector] = r.count;
      byDay[day].total += r.count;
    });

    return res.json({
      status: true,
      jwt,
      scansToday: {
        date: todayIST,
        count: scansToday.length,
        success: scansToday.filter((s) => s.status === 'success').length,
        failed: scansToday.filter((s) => s.status === 'failed').length,
        runs: scansToday
      },
      triggersByDaySector: Object.values(byDay)
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
}

module.exports.getOpsStatus = getOpsStatus;