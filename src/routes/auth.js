const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models/User');
const { authenticateToken } = require('../middlewares/auth');

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev';

// Signup
router.post('/signup', async (req, res) => {
    try {
        const { email, password, hikeId, publicKey, encryptedPrivateKey } = req.body;

        if (!email || !password || !hikeId || !publicKey || !encryptedPrivateKey) {
            return res.status(400).json({ error: 'All fields are required (email, password, hikeId, publicKey, encryptedPrivateKey)' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanHikeId = hikeId.trim().startsWith('@') ? hikeId.trim().slice(1).toLowerCase() : hikeId.trim().toLowerCase();

        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [{ email: cleanEmail }, { hikeId: cleanHikeId }],
        });

        if (existingUser) {
            return res.status(409).json({ error: 'User with this email or Hike ID already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Create user
        const newUser = await User.create({
            email: cleanEmail,
            passwordHash,
            hikeId: cleanHikeId,
            publicKey,
            encryptedPrivateKey,
        });

        // Generate JWT
        const token = jwt.sign({ userId: newUser._id, hikeId: newUser.hikeId }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            message: 'User created successfully',
            token,
            user: {
                id: newUser._id,
                email: newUser.email,
                hikeId: newUser.hikeId,
                publicKey: newUser.publicKey,
                encryptedPrivateKey: newUser.encryptedPrivateKey,
            },
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login — accepts email OR hikeId + password
router.post('/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ error: 'Email/Hike ID and password are required' });
        }

        // Detect whether identifier looks like an email or a hikeId
        const isEmail = identifier.includes('@') && identifier.includes('.');

        // Search by email OR hikeId (strip leading @ and lowercase)
        const cleanIdentifier = identifier.trim().startsWith('@') ? identifier.trim().slice(1).toLowerCase() : identifier.trim().toLowerCase();

        const user = await User.findOne(
            isEmail
                ? { email: cleanIdentifier }
                : { $or: [{ hikeId: cleanIdentifier }, { email: cleanIdentifier }] }
        );

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Sign JWT
        const token = jwt.sign({ userId: user._id, hikeId: user.hikeId }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                email: user.email,
                hikeId: user.hikeId,
                publicKey: user.publicKey,
                encryptedPrivateKey: user.encryptedPrivateKey,
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Set Hidden Mode PIN
router.post('/set-pin', authenticateToken, async (req, res) => {
    try {
        const { pin } = req.body;
        const userId = req.user?.userId;

        if (!pin) {
            return res.status(400).json({ error: 'PIN is required' });
        }

        const salt = await bcrypt.genSalt(10);
        const hiddenPinHash = await bcrypt.hash(pin.toString(), salt);

        await User.findByIdAndUpdate(userId, { hiddenPinHash });

        res.json({ message: 'Hidden Mode PIN set successfully' });
    } catch (error) {
        console.error('Set PIN error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
