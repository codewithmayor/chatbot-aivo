// server/routes/lead.js
const express = require('express');
const router  = express.Router();
const { saveLead } = require('../services/airtableService');

router.post('/', async (req, res) => {
  try {
    await saveLead(req.body);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
