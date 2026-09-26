// src/routes/index.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const triggerController = require('../controllers/trigger.controller');
const statusController = require('../controllers/status.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireAdmin } = require('../middlewares/admin.middleware');

router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.get('/status', statusController.getOpsStatus);
router.get('/profile', authenticate, authController.getProfile);  // ← Protected
router.post('/logout', authController.logout);

router.post('/test/run-triggers', triggerController.runTriggers);
router.get('/triggers/dates', triggerController.getTriggerDates);
router.get('/triggers', triggerController.getTriggers);
router.get('/admin/triggers/dates', requireAdmin, triggerController.getTriggerDatesAdmin);
router.get('/admin/triggers', requireAdmin, triggerController.getTriggersAdmin);
module.exports = router;