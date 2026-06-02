const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, unique: true },
        passwordHash: { type: String, required: true },
        hikeId: { type: String, required: true, unique: true },
        publicKey: { type: String, required: true },
        hiddenPinHash: { type: String },
        encryptedPrivateKey: { type: String },
    },
    {
        timestamps: true,
    }
);

const User = mongoose.model('User', userSchema);

module.exports = { User };
