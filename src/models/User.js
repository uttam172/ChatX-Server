const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, unique: true },
        passwordHash: { type: String, required: true },
        hikeId: { type: String, required: true, unique: true },
        publicKey: { type: String, required: true },
        hiddenPinHash: { type: String },
        encryptedPrivateKey: { type: String },
        profilePicture: { type: String, default: "" },
        avatarSeed: { type: String, default: "" },
        avatarStyle: { type: String, default: "initials" },
        bio: { type: String, default: "Hey there! I am using ChatX." },
    },
    {
        timestamps: true,
    }
);

const User = mongoose.model('User', userSchema);

module.exports = { User };
