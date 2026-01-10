const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { parsePackageImage } = require('./gemini-parser');
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
