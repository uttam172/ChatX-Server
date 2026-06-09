const { Router } = require('express');
const { User } = require('../models/User');
const { ChatSettings } = require('../models/ChatSettings');
const { Message } = require('../models/Message');
const { authenticateToken } = require('../middlewares/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const router = Router();

// Helper to sanitize hibernating users
const sanitizeUser = (user) => {
    if (!user) return user;
    const u = typeof user.toObject === 'function' ? user.toObject() : user;
    if (u.isHibernated) {
        return {
            ...u,
            hikeId: 'Hibernating User',
            profilePicture: '',
            avatarSeed: 'Hibernating User',
            avatarStyle: 'initials',
            bio: 'This user is currently hibernating.',
            publicKey: ''
        };
    }
    return u;
};

// Helper to sanitize groups
const sanitizeGroup = (group) => {
    if (!group) return null;
    const g = typeof group.toObject === 'function' ? group.toObject() : group;
    if (g.members) {
        g.members = g.members.map(m => sanitizeUser(m));
    }
    if (g.latestMessage) {
        if (g.latestMessage.senderId) {
            g.latestMessage.senderId = sanitizeUser(g.latestMessage.senderId);
        }
    }
    return g;
};

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
            isHibernated: { $ne: true },           // exclude hibernated
            $or: [{ hikeId: regex }, { email: regex }],
        })
            .select('hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated')
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
        const users = await User.find({ _id: { $ne: currentUserId }, isHibernated: { $ne: true } })
            .select('hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated')
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

// Update Chat Theme and Background (For both peer-to-peer and group chats)
router.post('/chat-settings/theme', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { peerId, groupId, theme, customBackground } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!peerId && !groupId) {
            return res.status(400).json({ error: 'Must specify peerId or groupId' });
        }

        const query = { userId };
        if (peerId) {
            query.peerId = peerId;
        } else {
            query.groupId = groupId;
        }

        const updates = {};
        if (theme !== undefined) updates.theme = theme;
        if (customBackground !== undefined) updates.customBackground = customBackground;

        const settings = await ChatSettings.findOneAndUpdate(
            query,
            { $set: updates },
            { new: true, upsert: true }
        );

        res.json(settings);
    } catch (error) {
        console.error('Update theme error:', error);
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
                    receiverId: { $ne: null },
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
            if (item._id) {
                unreadMap[item._id.toString()] = item.count;
            }
        });

        const userIds = recentMessages.map(m => m._id).filter(Boolean);
        const users = await User.find({ _id: { $in: userIds } })
            .select('hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated');

        const sortedUsers = userIds
            .map(id => {
                if (!id) return null;
                const user = users.find(u => u && u._id && u._id.toString() === id.toString());
                const msgInfo = recentMessages.find(m => m._id && m._id.toString() === id.toString());
                if (!user) return null;
                const sanitizedUser = sanitizeUser(user);
                return {
                    ...sanitizedUser,
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

// Delete account completely
router.delete('/delete-account', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);

        // 1. Find all groups the user is currently a member of BEFORE pulling them
        const { Group } = require('../models/Group');
        const groupsUserWasIn = await Group.find({ members: userObjectId });

        // 2. Remove user from all groups and handle admin transfer if deleted user was the creator
        for (const group of groupsUserWasIn) {
            const remainingMembers = group.members.filter(m => m.toString() !== userId.toString());
            if (group.createdBy.toString() === userId.toString() && remainingMembers.length > 0) {
                // Promote the first remaining member to admin
                await Group.updateOne(
                    { _id: group._id },
                    { 
                        $pull: { members: userObjectId },
                        $set: { createdBy: remainingMembers[0] }
                    }
                );
            } else {
                // Just remove the user from the members list
                await Group.updateOne(
                    { _id: group._id },
                    { $pull: { members: userObjectId } }
                );
            }
        }

        // 3. Delete user's chat settings
        await ChatSettings.deleteMany({ userId: userObjectId });
        await ChatSettings.deleteMany({ peerId: userObjectId });

        // 4. Delete user's messages
        await Message.deleteMany({
            $or: [
                { senderId: userObjectId },
                { receiverId: userObjectId }
            ]
        });

        // 5. Delete user from database
        await User.findByIdAndDelete(userObjectId);

        // 6. Clean up empty groups and notify remaining members of the groups they left
        const io = req.app.get('socketio');
        if (io) {
            for (const group of groupsUserWasIn) {
                const updatedGroup = await Group.findById(group._id)
                    .populate('members', 'hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated');

                if (updatedGroup) {
                    if (updatedGroup.members.length === 0) {
                        // If no members left in group, delete the group document
                        await Group.deleteOne({ _id: group._id });
                        await ChatSettings.deleteMany({ groupId: group._id });
                        io.to(`group_${group._id}`).emit('group_removed', { groupId: group._id.toString(), reason: 'deleted' });
                    } else {
                        // Broadcast updated group details to remaining members
                        io.to(`group_${group._id}`).emit('group_updated', sanitizeGroup(updatedGroup));
                    }
                }
            }
        }

        res.json({ success: true, message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Hibernate account temporarily
router.post('/hibernate', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.isHibernated = true;
        await user.save();

        res.json({ success: true, message: 'Account hibernated successfully' });
    } catch (error) {
        console.error('Hibernate account error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
