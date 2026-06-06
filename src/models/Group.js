const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        profilePicture: { type: String, default: "" },
        avatarSeed: { type: String, default: "" },
        avatarStyle: { type: String, default: "initials" },
    },
    {
        timestamps: true,
    }
);

const Group = mongoose.model('Group', groupSchema);

module.exports = { Group };
