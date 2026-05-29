// !! MUST be the very first line before any other imports !!
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';

import connectDB from './config/db';
import { Message } from './models/Message';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';

const JWT_SECRET = process.env.JWT_SECRET as string;
const PORT = process.env.PORT || 5000;

// Connect to MongoDB Atlas
connectDB();

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  process.env.CLIENT_URL || '',
].filter(Boolean);

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
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

// ─── Socket.io Auth Middleware ────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; hikeId: string };
    socket.data.userId = decoded.userId;
    socket.data.hikeId = decoded.hikeId;
    next();
  } catch {
    next(new Error('Authentication error: Invalid or expired token'));
  }
});

// ─── Socket.io Events ────────────────────────────────────
io.on('connection', (socket) => {
  const userId: string = socket.data.userId;
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

  // ── typing indicator ──────────────────────────────────
  socket.on('typing', (data: { receiverId: string; isTyping: boolean }) => {
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
