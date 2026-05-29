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
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = require("../models/User");
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev';
// Signup
router.post('/signup', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, password, hikeId, publicKey } = req.body;
        if (!email || !password || !hikeId || !publicKey) {
            return res.status(400).json({ error: 'All fields are required (email, password, hikeId, publicKey)' });
        }
        // Check if user already exists
        const existingUser = yield User_1.User.findOne({
            $or: [{ email }, { hikeId }],
        });
        if (existingUser) {
            return res.status(409).json({ error: 'User with this email or Hike ID already exists' });
        }
        // Hash password
        const salt = yield bcryptjs_1.default.genSalt(10);
        const passwordHash = yield bcryptjs_1.default.hash(password, salt);
        // Create user
        const newUser = yield User_1.User.create({
            email,
            passwordHash,
            hikeId,
            publicKey,
        });
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId: newUser._id, hikeId: newUser.hikeId }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({
            message: 'User created successfully',
            token,
            user: {
                id: newUser._id,
                email: newUser.email,
                hikeId: newUser.hikeId,
            },
        });
    }
    catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// Login
router.post('/login', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        // Find user
        const user = yield User_1.User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        // Check password
        const isMatch = yield bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId: user._id, hikeId: user.hikeId }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                email: user.email,
                hikeId: user.hikeId,
                publicKey: user.publicKey,
            },
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// Set Hidden Mode PIN
router.post('/set-pin', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { pin } = req.body;
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
        if (!pin) {
            return res.status(400).json({ error: 'PIN is required' });
        }
        const salt = yield bcryptjs_1.default.genSalt(10);
        const hiddenPinHash = yield bcryptjs_1.default.hash(pin.toString(), salt);
        yield User_1.User.findByIdAndUpdate(userId, { hiddenPinHash });
        res.json({ message: 'Hidden Mode PIN set successfully' });
    }
    catch (error) {
        console.error('Set PIN error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
exports.default = router;
