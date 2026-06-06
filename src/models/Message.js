const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
    {
        senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
        ciphertext: { type: String, required: true },
        iv: { type: String, required: true },
        encryptedAesKeySender: { type: String, required: true },
        encryptedAesKeyReceiver: { type: String },
        groupAesKeys: [
            {
                userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
                encryptedAesKey: { type: String, required: true }
            }
        ],
        readBy: [
            { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
        ],
        isNudge: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
        replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
        mediaUrl: { type: String, default: null },
        mediaType: { type: String, default: null },
        mediaName: { type: String, default: null },
        mediaSize: { type: Number, default: null },
        reactions: [
            {
                userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
                emoji: { type: String, required: true }
            }
        ],
        isEdited: { type: Boolean, default: false },
        editedAt: { type: Date, default: null },
        delivered: { type: Boolean, default: false },
    },
    {
        timestamps: true,
    }
);

const Message = mongoose.model('Message', messageSchema);

module.exports = { Message };
