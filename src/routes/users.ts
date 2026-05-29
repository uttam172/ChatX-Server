import { Router } from 'express';
import { User } from '../models/User';
import { ChatSettings } from '../models/ChatSettings';
import { AuthRequest, authenticateToken } from '../middlewares/auth';
import bcrypt from 'bcryptjs';

const router = Router();

// Get current user profile
router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const user = await User.findById(userId).select('-passwordHash -hiddenPinHash');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search users by hikeId or email
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.json([]);
    }

    const regex = new RegExp(q, 'i'); // Case-insensitive regex search
    const users = await User.find({
      $or: [{ hikeId: regex }, { email: regex }],
    })
      .select('hikeId publicKey') // Only return what's needed
      .limit(20);

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify Hidden PIN
router.post('/verify-pin', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const { pin } = req.body;
        const userId = req.user?.userId;

        if (!pin) {
            return res.status(400).json({ error: 'PIN is required' });
        }

        const user = await User.findById(userId);
        
        if (!user || !user.hiddenPinHash) {
            return res.status(400).json({ error: 'No PIN configured' });
        }

        const isMatch = await bcrypt.compare(pin.toString(), user.hiddenPinHash);
        
        if (isMatch) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid PIN' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Toggle Chat Hidden Status
router.post('/chat-settings/hidden', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.userId;
        const { peerId, isHidden } = req.body;

        if (!userId || !peerId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        const settings = await ChatSettings.findOneAndUpdate(
            { userId, peerId },
            { isHidden },
            { new: true, upsert: true }
        );

        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get User's Chat Settings
router.get('/chat-settings', authenticateToken, async (req: AuthRequest, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const settings = await ChatSettings.find({ userId });

        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
