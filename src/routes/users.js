const { Router } = require('express');
const { User } = require('../models/User');
const { ChatSettings } = require('../models/ChatSettings');
const { Message } = require('../models/Message');
const { authenticateToken } = require('../middlewares/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const router = Router();

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
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

// Update current user profile
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { hikeId, email, bio, profilePicture, avatarSeed, avatarStyle } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updates = {};

        // Update email if provided
        if (email !== undefined) {
            const cleanEmail = email.trim().toLowerCase();
            if (!cleanEmail) {
                return res.status(400).json({ error: 'Email cannot be empty' });
            }
            // Check uniqueness
            const existingEmail = await User.findOne({ email: cleanEmail, _id: { $ne: userId } });
            if (existingEmail) {
                return res.status(409).json({ error: 'Email is already taken by another user' });
            }
            updates.email = cleanEmail;
        }

        // Update username (hikeId) if provided
        if (hikeId !== undefined) {
            const cleanHikeId = hikeId.trim().startsWith('@') 
                ? hikeId.trim().slice(1).toLowerCase() 
                : hikeId.trim().toLowerCase();
            if (!cleanHikeId) {
                return res.status(400).json({ error: 'Username cannot be empty' });
            }
            // Check uniqueness
            const existingHikeId = await User.findOne({ hikeId: cleanHikeId, _id: { $ne: userId } });
            if (existingHikeId) {
                return res.status(409).json({ error: 'Username is already taken by another user' });
            }
            updates.hikeId = cleanHikeId;
        }

        // Update other optional profile fields
        if (bio !== undefined) updates.bio = bio;
        if (profilePicture !== undefined) updates.profilePicture = profilePicture;
        if (avatarSeed !== undefined) updates.avatarSeed = avatarSeed;
        if (avatarStyle !== undefined) updates.avatarStyle = avatarStyle;

        // Perform the update
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true }
        ).select('-passwordHash -hiddenPinHash');

        // If hikeId was changed, generate a new JWT token
        let token = null;
        if (updates.hikeId && updates.hikeId !== user.hikeId) {
            const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev';
            token = jwt.sign({ userId: updatedUser._id, hikeId: updatedUser.hikeId }, JWT_SECRET, { expiresIn: '7d' });
        }

        res.json({
            user: updatedUser,
            token
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Search users by hikeId or email
router.get('/search', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;
        const currentUserId = req.user?.userId;

        if (!q || typeof q !== 'string') {
            return res.json([]);
        }

        const regex = new RegExp(q.replace(/^@/, ''), 'i');
        const users = await User.find({
            _id: { $ne: currentUserId },           // exclude self
            $or: [{ hikeId: regex }, { email: regex }],
        })
            .select('hikeId publicKey profilePicture avatarSeed avatarStyle bio')
            .limit(20);

        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all users (excluding self) — used to populate sidebar on load
router.get('/all', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user?.userId;
        const users = await User.find({ _id: { $ne: currentUserId } })
            .select('hikeId publicKey profilePicture avatarSeed avatarStyle bio')
            .sort({ createdAt: -1 });   // newest signups first

        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify Hidden PIN
router.post('/verify-pin', authenticateToken, async (req, res) => {
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
router.post('/chat-settings/hidden', authenticateToken, async (req, res) => {
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
router.get('/chat-settings', authenticateToken, async (req, res) => {
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

// Get recent chatted users sorted by latest message timestamp
router.get('/recent', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const recentMessages = await Message.aggregate([
            {
                $match: {
                    $or: [
                        { senderId: new mongoose.Types.ObjectId(userId) },
                        { receiverId: new mongoose.Types.ObjectId(userId) }
                    ]
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ["$senderId", new mongoose.Types.ObjectId(userId)] },
                            "$receiverId",
                            "$senderId"
                        ]
                    },
                    latestMessage: { $first: "$$ROOT" }
                }
            },
            {
                $sort: { "latestMessage.createdAt": -1 }
            }
        ]);

        const unreadCounts = await Message.aggregate([
            {
                $match: {
                    receiverId: new mongoose.Types.ObjectId(userId),
                    read: false
                }
            },
            {
                $group: {
                    _id: "$senderId",
                    count: { $sum: 1 }
                }
            }
        ]);

        const unreadMap = {};
        unreadCounts.forEach(item => {
            unreadMap[item._id.toString()] = item.count;
        });

        const userIds = recentMessages.map(m => m._id);
        const users = await User.find({ _id: { $in: userIds } })
            .select('hikeId publicKey profilePicture avatarSeed avatarStyle bio');

        const sortedUsers = userIds
            .map(id => {
                const user = users.find(u => u._id.toString() === id.toString());
                const msgInfo = recentMessages.find(m => m._id.toString() === id.toString());
                if (!user) return null;
                return {
                    ...user.toObject(),
                    latestMessage: msgInfo ? msgInfo.latestMessage : null,
                    unreadCount: unreadMap[id.toString()] || 0
                };
            })
            .filter(Boolean);

        res.json(sortedUsers);
    } catch (error) {
        console.error('Recent chats aggregation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get message history with a peer
router.get('/history/:peerId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { peerId } = req.params;

        if (!userId || !peerId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        // 1. Fetch messages first so we know their original read status
        const messages = await Message.find({
            $or: [
                { senderId: userId, receiverId: peerId },
                { senderId: peerId, receiverId: userId }
            ]
        }).sort({ createdAt: 1 });

        // 2. Mark messages as read in the database in the background
        const result = await Message.updateMany(
            { senderId: peerId, receiverId: userId, read: false },
            { $set: { read: true, delivered: true } }
        );

        if (result.modifiedCount > 0) {
            const io = req.app.get('socketio');
            if (io) {
                io.to(peerId).emit('messages_seen', { readerId: userId });
            }
        }

        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Mark all messages from a peer as read
router.post('/read/:peerId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { peerId } = req.params;

        if (!userId || !peerId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        const result = await Message.updateMany(
            { senderId: peerId, receiverId: userId, read: false },
            { $set: { read: true, delivered: true } }
        );

        if (result.modifiedCount > 0) {
            const io = req.app.get('socketio');
            if (io) {
                io.to(peerId).emit('messages_seen', { readerId: userId });
            }
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Clear message history with a peer
router.delete('/history/:peerId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { peerId } = req.params;

        if (!userId || !peerId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        await Message.deleteMany({
            $or: [
                { senderId: userId, receiverId: peerId },
                { senderId: peerId, receiverId: userId }
            ]
        });

        res.json({ message: 'Chat history cleared successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user's E2EE Public Key & Private Key Backup
router.post('/update-public-key', authenticateToken, async (req, res) => {
    try {
        const { publicKey, encryptedPrivateKey } = req.body;
        const userId = req.user?.userId;

        if (!publicKey) {
            return res.status(400).json({ error: 'Public key is required' });
        }

        const updateData = { publicKey };
        if (encryptedPrivateKey) {
            updateData.encryptedPrivateKey = encryptedPrivateKey;
        }

        const user = await User.findByIdAndUpdate(userId, updateData, { new: true });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'Keys updated successfully', publicKey: user.publicKey });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
