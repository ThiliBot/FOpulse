// src/app.js
const connectDB = require('./config/db');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cron = require('node-cron');
const path = require('path');

const triggerService = require('./services/trigger.service');

require('dotenv').config();
console.log('🔑 ANGEL_API_KEY:', process.env.ANGEL_API_KEY ? 'Loaded' : 'MISSING');
const authRoutes = require('./routes/index');
const { NIFTY50_SYMBOLS } = require('./config/symbols');
const app = express();

// Middleware
connectDB();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static('public'));

// Routes
app.use('/api', authRoutes); // e.g., POST /api/auth/login

// Health check (optional)
app.get('/', (req, res) => {
  res.json({ 
    message: 'Angel One API Node.js Service',
    status: 'running'
  });
});

app.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/status.html'));
});

const PORT = process.env.PORT || 3003;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
//ceon runs every 1 hour from 9:30 am
// cron.schedule('30 9-15 * * 1-5', async () => {
//   const now = new Date();
// const ist = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
//   console.log(`\n⏰ Cron triggered at ${ist} IST`);

//   try {
//     await triggerService.runTriggerJob(NIFTY50_SYMBOLS);
//   } catch (err) {
//     console.error('Cron job failed:', err.message);
//   }
// }, {
//   timezone: 'Asia/Kolkata'
// });
cron.schedule('32,0,30 9-15 * * 1-5', async () => {
  const { hour, minute } = getISTParts();
  const mins = hour * 60 + minute;

  if (mins < 9 * 60 + 32) return;   // skip 09:00
  if (mins > 15 * 60 + 5) return;   // 15:30 belongs to the close job

  await triggerService.runTriggerJob(symbols, { bucket: 'intraday' });
}, { timezone: 'Asia/Kolkata' });

cron.schedule('40 15 * * 1-5', async () => {
  await triggerService.runTriggerJob(symbols, { bucket: 'close' });
}, { timezone: 'Asia/Kolkata' });