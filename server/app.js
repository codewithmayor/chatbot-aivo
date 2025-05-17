require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const webhook = require('./routes/webhook');
const leadAPI = require('./routes/lead');

const app = express();
app.use(cors());
app.use(express.json());

// Instagram webhook endpoints
app.use('/webhook', webhook);
// Airtable lead endpoint (for manual lead imports/tests)
app.use('/api/lead', leadAPI);

// (Optional) static UI under /client for local testing
app.use('/', express.static(path.join(__dirname, '../client')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));