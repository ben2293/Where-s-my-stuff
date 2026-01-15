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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
