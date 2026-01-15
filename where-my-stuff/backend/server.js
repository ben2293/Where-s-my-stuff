const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { parsePackageImage } = require('./gemini-parser');
const { extractStatus } = require('./emailStatusParser');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

app.post('/api/parse-package', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const packageData = await parsePackageImage(
      req.file.buffer,
      req.file.mimetype
    );

    res.json(packageData);
  } catch (error) {
    console.error('Error parsing package:', error);
    res.status(500).json({ error: 'Failed to parse package image' });
  }
});

app.post('/api/parse-email', express.json(), async (req, res) => {
 try {
 const { subject, body, orderNumber } = req.body;
 if (!subject && !body) {
 return res.status(400).json({ error: 'Email subject or body required' });
 }
 const email = { subject: subject || '', body: body || '' };
 const status = extractStatus(email);
 res.json({ status, orderNumber: orderNumber || null });
 } catch (error) {
 console.error('Error parsing email:', error);
 res.status(500).json({ error: 'Failed to parse email' });
 }
});

// In-memory storage for packages (in production, use a database)
const packagesDB = {};

// /api/packages - Get stored packages for a user
app.get('/api/packages', (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'Email query parameter required' });
    }
    const packages = packagesDB[email] || [];
    res.json(packages);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

// /api/sync - Sync packages from Gmail (simplified)
app.post('/api/sync', express.json(), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // TODO: In production, integrate Google Gmail API to fetch real emails
    // For now, return empty array as packages need to be added via manual email parsing
    // This is where the actual Gmail API integration would happen

    res.json({ 
      success: true, 
      message: 'Sync completed',
      packagesCount: packagesDB[email]?.length || 0
    });
  } catch (error) {
    console.error('Error syncing packages:', error);
    res.status(500).json({ error: 'Failed to sync packages' });
  }
});

// /api/packages/add - Manual package addition
app.post('/api/packages/add', express.json(), async (req, res) => {
  try {
    const { email, packageData } = req.body;
    if (!email || !packageData) {
      return res.status(400).json({ error: 'Email and packageData required' });
    }

    if (!packagesDB[email]) {
      packagesDB[email] = [];
    }

    packagesDB[email].push(packageData);

    res.json({ 
      success: true, 
      message: 'Package added',
      packages: packagesDB[email]
    });
  } catch (error) {
    console.error('Error adding package:', error);
    res.status(500).json({ error: 'Failed to add package' });
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
