"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
// !! MUST be the very first line before any other imports !!
const dotenv = __importStar(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv.config({ path: path_1.default.resolve(process.cwd(), '.env') });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("./config/db"));
const Message_1 = require("./models/Message");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 5000;
// Connect to MongoDB Atlas
(0, db_1.default)();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const allowedOrigins = [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    process.env.CLIENT_URL || '',
].filter(Boolean);
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            callback(null, true);
        }
        else {
            callback(null, true); // During dev: allow all — tighten in production
        }
    },
    credentials: true,
};
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
app.get('/', (req, res) => {
    res.json({ status: "Backend Running" });
});
// ─── Middleware ───────────────────────────────────────────
app.use((0, cors_1.default)(corsOptions));
app.use(express_1.default.json());
// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// ─── REST Routes ──────────────────────────────────────────
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
// ─── Socket.io Auth Middleware ────────────────────────────
io.use((socket, next) => {
    var _a;
    const token = (_a = socket.handshake.auth) === null || _a === void 0 ? void 0 : _a.token;
    if (!token) {
        return next(new Error('Authentication error: No token provided'));
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        socket.data.userId = decoded.userId;
        socket.data.hikeId = decoded.hikeId;
        next();
    }
    catch (_b) {
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
    socket.on('send_message', (data) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { receiverId, ciphertext, iv, encryptedAesKeySender, encryptedAesKeyReceiver, isNudge, } = data;
            if (!receiverId || !ciphertext || !iv) {
                socket.emit('error', { message: 'Invalid message payload' });
                return;
            }
            // Persist encrypted message (server never sees plaintext)
            const message = yield Message_1.Message.create({
                senderId: userId,
                receiverId,
                ciphertext,
                iv,
                encryptedAesKeySender,
                encryptedAesKeyReceiver,
                isNudge: isNudge !== null && isNudge !== void 0 ? isNudge : false,
            });
            // Deliver to receiver's private room
            io.to(receiverId).emit('receive_message', message.toObject());
            // Echo back to sender for confirmation / multi-device sync
            socket.emit('message_sent', message.toObject());
        }
        catch (error) {
            console.error('send_message error:', error);
            socket.emit('error', { message: 'Failed to send message. Please try again.' });
        }
    }));
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
