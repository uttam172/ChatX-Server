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
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("./config/db"));
const Message_1 = require("./models/Message");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
dotenv_1.default.config();
// Connect to MongoDB Atlas
(0, db_1.default)();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*', // For dev; restrict in prod
        methods: ['GET', 'POST'],
    },
});
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev';
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
// Socket.io Middleware for Auth
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error: No token provided'));
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        socket.data.userId = decoded.userId;
        socket.data.hikeId = decoded.hikeId;
        next();
    }
    catch (err) {
        next(new Error('Authentication error: Invalid token'));
    }
});
// Socket.io Connection Handler
io.on('connection', (socket) => {
    const userId = socket.data.userId;
    console.log(`User connected: ${socket.data.hikeId} (${socket.id})`);
    // Join a personal room to easily receive messages
    socket.join(userId);
    socket.on('send_message', (data) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { receiverId, ciphertext, iv, encryptedAesKeySender, encryptedAesKeyReceiver, isNudge } = data;
            // Save to database
            const message = yield Message_1.Message.create({
                senderId: userId,
                receiverId,
                ciphertext,
                iv,
                encryptedAesKeySender,
                encryptedAesKeyReceiver,
                isNudge: isNudge || false
            });
            // Emit to receiver's room
            io.to(receiverId).emit('receive_message', message);
            // Also emit back to sender so other devices they own can sync, or just for local confirmation
            socket.emit('message_sent', message);
        }
        catch (error) {
            console.error('Error handling send_message:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    }));
    socket.on('typing', (data) => {
        const { receiverId, isTyping } = data;
        io.to(receiverId).emit('typing_status', { senderId: userId, isTyping });
    });
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.data.hikeId}`);
    });
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
