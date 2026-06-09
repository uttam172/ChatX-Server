const { Router } = require('express');
const { Group } = require('../models/Group');
const { Message } = require('../models/Message');
const { authenticateToken } = require('../middlewares/auth');

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

// Helper to sanitize group messages
const sanitizeMessage = (msg) => {
    if (!msg) return null;
    const m = typeof msg.toObject === 'function' ? msg.toObject() : msg;
    if (m.senderId) {
        m.senderId = sanitizeUser(m.senderId);
    }
    return m;
};

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
            .populate('members', 'hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated');

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
            io.to(`group_${group._id.toString()}`).emit('group_created', sanitizeGroup(populatedGroup));
        }

        res.status(201).json(sanitizeGroup(populatedGroup));
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
            .populate('members', 'hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated')
            .sort({ updatedAt: -1 });

        const groupsWithMetadata = await Promise.all(
            groups.map(async (group) => {
                // Find latest message in group
                const latestMessage = await Message.findOne({ groupId: group._id })
                    .populate('senderId', 'hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated')
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

        res.json(groupsWithMetadata.map(sanitizeGroup));
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
            .populate('senderId', 'hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated')
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

        res.json(messages.map(sanitizeMessage));
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

        if (req.body.profilePicture !== undefined) {
            group.profilePicture = req.body.profilePicture;
        }
        if (req.body.avatarSeed !== undefined) {
            group.avatarSeed = req.body.avatarSeed;
        }
        if (req.body.avatarStyle !== undefined) {
            group.avatarStyle = req.body.avatarStyle;
        }

        await group.save();

        const populatedGroup = await Group.findById(group._id)
            .populate('members', 'hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated');

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
            io.to(`group_${group._id.toString()}`).emit('group_updated', sanitizeGroup(populatedGroup));

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
                io.to(memberId).emit('group_removed', { groupId: group._id.toString(), reason: 'removed' });
            });
        }

        res.json(sanitizeGroup(populatedGroup));
    } catch (error) {
        console.error('Update group error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Leave a group (Only non-admin members can do this)
router.post('/:groupId/leave', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        const currentUserId = req.user?.userId;

        if (!currentUserId || !groupId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Verify user is a member of the group
        const isMember = group.members.some(m => m.toString() === currentUserId.toString());
        if (!isMember) {
            return res.status(403).json({ error: 'Access denied: You are not a member of this group' });
        }

        // If the leaving user is the creator (admin)
        if (group.createdBy.toString() === currentUserId.toString()) {
            const remainingMembers = group.members.filter(m => m.toString() !== currentUserId.toString());
            if (remainingMembers.length === 0) {
                // If no other members left, delete the group entirely
                await Group.deleteOne({ _id: groupId });

                const io = req.app.get('socketio');
                if (io) {
                    io.to(currentUserId.toString()).emit('group_removed', { groupId: group._id.toString(), reason: 'left' });
                }

                return res.json({ success: true, message: 'Group deleted as the admin left and no other members remained.' });
            } else {
                // Transfer admin rights to the first remaining member
                group.createdBy = remainingMembers[0];
            }
        }

        // Remove user from members list
        group.members = group.members.filter(m => m.toString() !== currentUserId.toString());
        await group.save();

        const populatedGroup = await Group.findById(group._id)
            .populate('members', 'hikeId publicKey profilePicture avatarSeed avatarStyle bio isHibernated');

        const io = req.app.get('socketio');
        const userConnections = req.app.get('userConnections');
        if (io) {
            // Remove leaving user's sockets from the group room
            if (userConnections) {
                const memberSockets = userConnections.get(currentUserId.toString());
                if (memberSockets) {
                    memberSockets.forEach(sId => {
                        const s = io.sockets.sockets.get(sId);
                        if (s) {
                            s.leave(`group_${group._id.toString()}`);
                            console.log(`📡 socket leave group_${group._id} room for leaving member`);
                        }
                    });
                }
            }

            // Emit group_removed to the leaving user
            io.to(currentUserId.toString()).emit('group_removed', { groupId: group._id.toString(), reason: 'left' });

            // Broadcast group_updated to remaining members
            io.to(`group_${group._id.toString()}`).emit('group_updated', sanitizeGroup(populatedGroup));
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Leave group error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete a group (Only admin can do this)
router.delete('/:groupId', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        const currentUserId = req.user?.userId;

        if (!currentUserId || !groupId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Verify user is the admin (creator) of the group
        if (group.createdBy.toString() !== currentUserId.toString()) {
            return res.status(403).json({ error: 'Access denied: Only the group admin can delete the group' });
        }

        const memberIds = group.members.map(m => m.toString());

        // Delete the group document
        await Group.deleteOne({ _id: groupId });

        // Delete all messages associated with the group
        await Message.deleteMany({ groupId });

        const io = req.app.get('socketio');
        const userConnections = req.app.get('userConnections');
        if (io) {
            // Broadcast group_removed with reason "deleted" to the group room
            io.to(`group_${groupId}`).emit('group_removed', { groupId, reason: 'deleted' });

            // Force all members' sockets to leave the group room
            if (userConnections) {
                memberIds.forEach(memberId => {
                    const memberSockets = userConnections.get(memberId);
                    if (memberSockets) {
                        memberSockets.forEach(sId => {
                            const s = io.sockets.sockets.get(sId);
                            if (s) {
                                s.leave(`group_${groupId}`);
                            }
                        });
                    }
                });
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete group error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
