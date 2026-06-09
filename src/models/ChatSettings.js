const mongoose = require('mongoose');

const chatSettingsSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        peerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
        isHidden: { type: Boolean, default: false },
        theme: { type: String, default: 'default' },
        customBackground: { type: String, default: '' },
    },
    {
        timestamps: true,
    }
);

// Ensure a user can only have one settings record per peer/group
chatSettingsSchema.index(
    { userId: 1, peerId: 1 },
    { unique: true, partialFilterExpression: { peerId: { $exists: true, $ne: null } } }
);
chatSettingsSchema.index(
    { userId: 1, groupId: 1 },
    { unique: true, partialFilterExpression: { groupId: { $exists: true, $ne: null } } }
);

const ChatSettings = mongoose.model('ChatSettings', chatSettingsSchema);

module.exports = { ChatSettings };
