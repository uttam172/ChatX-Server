// Support resolving 'node:' prefixed core modules on older Node.js versions (like v14.17.3)
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (typeof request === 'string' && request.startsWith('node:')) {
        const stripped = request.substring(5);
        try {
            return originalResolveFilename.apply(this, arguments);
        } catch (err) {
            arguments[0] = stripped;
            return originalResolveFilename.apply(this, arguments);
        }
    }
    return originalResolveFilename.apply(this, arguments);
};

// !! MUST be the very first line before any other imports !!
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const connectDB = require('./config/db');
const { Message } = require('./models/Message');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const mediaRoutes = require('./routes/media');

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 5000;

// Connect to MongoDB Atlas
connectDB();

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'https://chatx-client.vercel.app',
    process.env.CLIENT_URL || '',
].filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            callback(null, true);
        } else {
            callback(null, true); // During dev: allow all — tighten in production
        }
    },
    credentials: true,
};

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

app.get('/', (req, res) => {
    res.json({ status: "Backend Running" });
});

// ─── Middleware ───────────────────────────────────────────
app.use(cors(corsOptions));
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── REST Routes ──────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/media', mediaRoutes);

// ─── Socket.io Auth Middleware ────────────────────────────
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
        return next(new Error('Authentication error: No token provided'));
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.data.userId = decoded.userId;
        socket.data.hikeId = decoded.hikeId;
        next();
    } catch {
        next(new Error('Authentication error: Invalid or expired token'));
    }
});

// ─── Socket.io Events ────────────────────────────────────
io.on('connection', (socket) => {
    const userId = socket.data.userId;
    console.log(`✅ User connected: @${socket.data.hikeId} (socket: ${socket.id})`);

    // Each user joins their own private room so we can target them directly
    socket.join(userId);

    // ── send_message ──────────────────────────────────────
    socket.on('send_message', async (data) => {
        try {
            const {
                receiverId,
                ciphertext,
                iv,
                encryptedAesKeySender,
                encryptedAesKeyReceiver,
                isNudge,
                replyTo,
                mediaUrl,
                mediaType,
                mediaName,
                mediaSize,
            } = data;

            if (!receiverId || !ciphertext || !iv) {
                socket.emit('error', { message: 'Invalid message payload' });
                return;
            }

            // Persist encrypted message (server never sees plaintext)
            const message = await Message.create({
                senderId: userId,
                receiverId,
                ciphertext,
                iv,
                encryptedAesKeySender,
                encryptedAesKeyReceiver,
                isNudge: isNudge ?? false,
                replyTo: replyTo || null,
                mediaUrl: mediaUrl || null,
                mediaType: mediaType || null,
                mediaName: mediaName || null,
                mediaSize: mediaSize || null,
            });

            // Deliver to receiver's private room
            io.to(receiverId).emit('receive_message', message.toObject());

            // Echo back to sender for confirmation / multi-device sync
            socket.emit('message_sent', message.toObject());

        } catch (error) {
            console.error('send_message error:', error);
            socket.emit('error', { message: 'Failed to send message. Please try again.' });
        }
    });

    // ── unsend_message ────────────────────────────────────
    socket.on('unsend_message', async (data) => {
        try {
            const { messageId } = data;
            if (!messageId) return;

            const message = await Message.findById(messageId);
            if (!message) return;

            // Verify if socket user is the sender
            if (message.senderId.toString() !== userId.toString()) {
                socket.emit('error', { message: 'Unauthorized to unsend this message' });
                return;
            }

            // Deletes the message persistently from MongoDB
            await Message.findByIdAndDelete(messageId);

            // Broadcast unsend event
            io.to(message.receiverId.toString()).emit('message_unsended', { messageId });
            io.to(message.senderId.toString()).emit('message_unsended', { messageId });

        } catch (error) {
            console.error('unsend_message error:', error);
        }
    });

    // ── edit_message ──────────────────────────────────────
    socket.on('edit_message', async (data) => {
        try {
            const { messageId, ciphertext, iv, encryptedAesKeySender, encryptedAesKeyReceiver } = data;
            if (!messageId || !ciphertext || !iv) {
                socket.emit('error', { message: 'Invalid edit payload' });
                return;
            }

            const message = await Message.findById(messageId);
            if (!message) {
                socket.emit('error', { message: 'Message not found' });
                return;
            }

            // Verify if socket user is the sender
            if (message.senderId.toString() !== userId.toString()) {
                socket.emit('error', { message: 'Unauthorized to edit this message' });
                return;
            }

            // Enforce the 1-hour editing limit
            const limitMs = 60 * 60 * 1000; // 1 hour
            const timeDiff = Date.now() - message.createdAt.getTime();
            if (timeDiff > limitMs) {
                socket.emit('error', { message: 'Messages can only be edited within 1 hour of sending.' });
                return;
            }

            // Update the message document
            message.ciphertext = ciphertext;
            message.iv = iv;
            message.encryptedAesKeySender = encryptedAesKeySender;
            message.encryptedAesKeyReceiver = encryptedAesKeyReceiver;
            message.isEdited = true;
            message.editedAt = new Date();

            await message.save();

            // Broadcast edited message event
            io.to(message.receiverId.toString()).emit('message_edited', message.toObject());
            io.to(message.senderId.toString()).emit('message_edited', message.toObject());

        } catch (error) {
            console.error('edit_message error:', error);
            socket.emit('error', { message: 'Failed to edit message. Please try again.' });
        }
    });

    // ── react_to_message ──────────────────────────────────
    socket.on('react_to_message', async (data) => {
        try {
            const { messageId, emoji } = data;
            if (!messageId || !emoji) return;

            const message = await Message.findById(messageId);
            if (!message) return;

            const existingReactionIdx = message.reactions.findIndex(
                (r) => r.userId.toString() === userId.toString()
            );

            if (existingReactionIdx > -1) {
                if (message.reactions[existingReactionIdx].emoji === emoji) {
                    // Toggle off
                    message.reactions.splice(existingReactionIdx, 1);
                } else {
                    // Update
                    message.reactions[existingReactionIdx].emoji = emoji;
                }
            } else {
                // Add new
                message.reactions.push({ userId, emoji });
            }

            await message.save();

            const updatedMsg = message.toObject();
            io.to(message.receiverId.toString()).emit('message_reaction', {
                messageId,
                reactions: updatedMsg.reactions,
            });
            io.to(message.senderId.toString()).emit('message_reaction', {
                messageId,
                reactions: updatedMsg.reactions,
            });

        } catch (error) {
            console.error('react_to_message error:', error);
        }
    });

    // ── typing indicator ──────────────────────────────────
    socket.on('typing', (data) => {
        io.to(data.receiverId).emit('typing_status', {
            senderId: userId,
            isTyping: data.isTyping,
        });
    });

    // ── disconnect ────────────────────────────────────────
    socket.on('disconnect', (reason) => {
        console.log(`❌ User disconnected: @${socket.data.hikeId} (reason: ${reason})`);
    });
});

// ─── Start Server ─────────────────────────────────────────
const PORT_NUM = Number(process.env.PORT) || 5000;
server.listen(PORT_NUM, '0.0.0.0', () => {
    console.log(`🚀 Backend running at http://0.0.0.0:${PORT_NUM}`);
    console.log(`🌐 LAN access → http://192.168.1.155:${PORT_NUM}`);
});
