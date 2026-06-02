const { Router } = require('express');
const cloudinary = require('cloudinary').v2;
const { authenticateToken } = require('../middlewares/auth');

const router = Router();

// Endpoint to generate secure signature for direct Cloudinary client-side uploads
router.post('/presigned-url', authenticateToken, async (req, res) => {
  try {
    const { fileName, fileType, fileSize } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: Missing user information' });
    }

    if (!fileName || !fileType || fileSize === undefined) {
      return res.status(400).json({ error: 'Invalid parameters. Please provide fileName, fileType, and fileSize.' });
    }

    // Size limit check: 100MB (100 * 1024 * 1024 bytes)
    const MAX_SIZE = 100 * 1024 * 1024;
    if (fileSize > MAX_SIZE) {
      return res.status(400).json({ error: 'File size exceeds the 100MB limitation.' });
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    // Check if Cloudinary is configured
    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(400).json({
        error: 'Cloudinary is not fully configured on the server. Please setup Cloudinary environment variables.',
        setupRequired: true
      });
    }

    // Configure Cloudinary SDK
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });

    // Generate secure signature valid for the next hour
    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = 'chatx_media';

    // Sign the timestamp and folder parameters
    const paramsToSign = {
      timestamp,
      folder,
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

    res.json({
      signature,
      timestamp,
      apiKey,
      cloudName,
      folder,
    });

  } catch (error) {
    console.error('Failed to generate Cloudinary signature:', error);
    res.status(500).json({ error: 'Failed to generate secure upload credentials.' });
  }
});

module.exports = router;
