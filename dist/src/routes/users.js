"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const User_1 = require("../models/User");
const ChatSettings_1 = require("../models/ChatSettings");
const auth_1 = require("../middlewares/auth");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const router = (0, express_1.Router)();
// Get current user profile
router.get('/me', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
        const user = yield User_1.User.findById(userId).select('-passwordHash -hiddenPinHash');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// Search users by hikeId or email
router.get('/search', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { q } = req.query;
        if (!q || typeof q !== 'string') {
            return res.json([]);
        }
        const regex = new RegExp(q, 'i'); // Case-insensitive regex search
        const users = yield User_1.User.find({
            $or: [{ hikeId: regex }, { email: regex }],
        })
            .select('hikeId publicKey') // Only return what's needed
            .limit(20);
        res.json(users);
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// Verify Hidden PIN
router.post('/verify-pin', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { pin } = req.body;
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
        if (!pin) {
            return res.status(400).json({ error: 'PIN is required' });
        }
        const user = yield User_1.User.findById(userId);
        if (!user || !user.hiddenPinHash) {
            return res.status(400).json({ error: 'No PIN configured' });
        }
        const isMatch = yield bcryptjs_1.default.compare(pin.toString(), user.hiddenPinHash);
        if (isMatch) {
            res.json({ success: true });
        }
        else {
            res.status(401).json({ error: 'Invalid PIN' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// Toggle Chat Hidden Status
router.post('/chat-settings/hidden', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
        const { peerId, isHidden } = req.body;
        if (!userId || !peerId) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }
        const settings = yield ChatSettings_1.ChatSettings.findOneAndUpdate({ userId, peerId }, { isHidden }, { new: true, upsert: true });
        res.json(settings);
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// Get User's Chat Settings
router.get('/chat-settings', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const settings = yield ChatSettings_1.ChatSettings.find({ userId });
        res.json(settings);
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
}));
exports.default = router;
