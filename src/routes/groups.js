const { Router } = require('express');
const { Group } = require('../models/Group');
const { Message } = require('../models/Message');
const { authenticateToken } = require('../middlewares/auth');

const router = Router();

// Create a new group
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, members } = req.body;
        const currentUserId = req.user?.userId;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Group name is required' });
        }

        if (!members || !Array.isArray(members)) {
            return res.status(400).json({ error: 'Members list is required' });
        }

        // Add creator to the members list if not already present
        const uniqueMembers = Array.from(new Set([...members, currentUserId]));

        const group = await Group.create({
            name: name.trim(),
            members: uniqueMembers,
            createdBy: currentUserId,
        });

        const populatedGroup = await Group.findById(group._id)
            .populate('members', 'hikeId publicKey');

        // Dynamically add all online members to the group socket.io room
        const io = req.app.get('socketio');
        const userConnections = req.app.get('userConnections');
        if (io && userConnections) {
            uniqueMembers.forEach(memberId => {
                const memberSockets = userConnections.get(memberId.toString());
                if (memberSockets) {
                    memberSockets.forEach(sId => {
                        const s = io.sockets.sockets.get(sId);
                        if (s) {
                            s.join(`group_${group._id.toString()}`);
                            console.log(`📡 @${s.data.hikeId} joined group_${group._id} room on creation`);
                        }
                    });
                }
            });

            // Broadcast group created socket event to all members so they update their lists
            io.to(`group_${group._id.toString()}`).emit('group_created', populatedGroup.toObject());
        }

        res.status(201).json(populatedGroup);
    } catch (error) {
        console.error('Create group error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all groups the current user is a member of (including latest message and unread count)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user?.userId;
        if (!currentUserId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const groups = await Group.find({ members: currentUserId })
            .populate('members', 'hikeId publicKey')
            .sort({ updatedAt: -1 });

        const groupsWithMetadata = await Promise.all(
            groups.map(async (group) => {
                // Find latest message in group
                const latestMessage = await Message.findOne({ groupId: group._id })
                    .populate('senderId', 'hikeId publicKey')
                    .sort({ createdAt: -1 });

                // Count unread group messages for the user
                const unreadCount = await Message.countDocuments({
                    groupId: group._id,
                    senderId: { $ne: currentUserId },
                    readBy: { $ne: currentUserId },
                });

                return {
                    ...group.toObject(),
                    latestMessage: latestMessage ? latestMessage.toObject() : null,
                    unreadCount,
                    isGroup: true,
                };
            })
        );

        res.json(groupsWithMetadata);
    } catch (error) {
        console.error('Fetch groups error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get message history for a group and mark all messages as read
router.get('/history/:groupId', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user?.userId;
        const { groupId } = req.params;

        if (!currentUserId || !groupId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        // Verify user is member of the group
        const group = await Group.findOne({ _id: groupId, members: currentUserId });
        if (!group) {
            return res.status(403).json({ error: 'Access denied: not a group member' });
        }

        const messages = await Message.find({ groupId })
            .populate('senderId', 'hikeId publicKey')
            .sort({ createdAt: 1 });

        // Mark messages as read by current user in the database
        const updateResult = await Message.updateMany(
            { groupId, senderId: { $ne: currentUserId }, readBy: { $ne: currentUserId } },
            { $addToSet: { readBy: currentUserId } }
        );

        if (updateResult.modifiedCount > 0) {
            const io = req.app.get('socketio');
            if (io) {
                io.to(`group_${groupId}`).emit('group_messages_seen', { groupId, readerId: currentUserId });
            }
        }

        res.json(messages);
    } catch (error) {
        console.error('Fetch group history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Mark all group messages as read
router.post('/read/:groupId', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user?.userId;
        const { groupId } = req.params;

        if (!currentUserId || !groupId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        // Verify member
        const group = await Group.findOne({ _id: groupId, members: currentUserId });
        if (!group) {
            return res.status(403).json({ error: 'Access denied: not a group member' });
        }

        const updateResult = await Message.updateMany(
            { groupId, senderId: { $ne: currentUserId }, readBy: { $ne: currentUserId } },
            { $addToSet: { readBy: currentUserId } }
        );

        if (updateResult.modifiedCount > 0) {
            const io = req.app.get('socketio');
            if (io) {
                io.to(`group_${groupId}`).emit('group_messages_seen', { groupId, readerId: currentUserId });
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Mark group read error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update group details (Only group creator / admin can do this)
router.put('/:groupId', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        const currentUserId = req.user?.userId;
        const { name, members } = req.body;

        if (!currentUserId || !groupId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Only creator of the group can edit group details
        if (group.createdBy.toString() !== currentUserId.toString()) {
            return res.status(403).json({ error: 'Access denied: Only the group admin can update group details' });
        }

        const prevMembers = group.members.map(m => m.toString());

        if (name && typeof name === 'string' && name.trim()) {
            group.name = name.trim();
        }

        if (members && Array.isArray(members)) {
            // Creator must always remain in the members list
            const uniqueMembers = Array.from(new Set([...members, group.createdBy.toString()]));
            group.members = uniqueMembers;
        }

        await group.save();

        const populatedGroup = await Group.findById(group._id)
            .populate('members', 'hikeId publicKey');

        const io = req.app.get('socketio');
        const userConnections = req.app.get('userConnections');
        if (io && userConnections) {
            const currentMembers = group.members.map(m => m.toString());
            
            // Added members: in current but not in prev
            const addedMembers = currentMembers.filter(m => !prevMembers.includes(m));
            // Removed members: in prev but not in current
            const removedMembers = prevMembers.filter(m => !currentMembers.includes(m));

            // Added members join group room
            addedMembers.forEach(memberId => {
                const memberSockets = userConnections.get(memberId);
                if (memberSockets) {
                    memberSockets.forEach(sId => {
                        const s = io.sockets.sockets.get(sId);
                        if (s) {
                            s.join(`group_${group._id.toString()}`);
                            console.log(`📡 @${s.data.hikeId} joined group_${group._id} room on updates`);
                        }
                    });
                }
            });

            // Broadcast group_updated to all current members
            io.to(`group_${group._id.toString()}`).emit('group_updated', populatedGroup.toObject());

            // Removed members leave group room and get removed event
            removedMembers.forEach(memberId => {
                const memberSockets = userConnections.get(memberId);
                if (memberSockets) {
                    memberSockets.forEach(sId => {
                        const s = io.sockets.sockets.get(sId);
                        if (s) {
                            s.leave(`group_${group._id.toString()}`);
                            console.log(`📡 socket leave group_${group._id} room for removed member`);
                        }
                    });
                }
                // Notify the removed member to clear the group chat from their UI
                io.to(memberId).emit('group_removed', { groupId: group._id.toString() });
            });
        }

        res.json(populatedGroup);
    } catch (error) {
        console.error('Update group error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
