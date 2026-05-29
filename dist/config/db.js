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
const mongoose_1 = __importDefault(require("mongoose"));
const connectDB = () => __awaiter(void 0, void 0, void 0, function* () {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('❌ MONGODB_URI is not defined in your .env file!');
        process.exit(1);
    }
    try {
        yield mongoose_1.default.connect(uri, {
            serverSelectionTimeoutMS: 10000, // 10 seconds to find a server
            connectTimeoutMS: 10000, // 10 seconds to establish connection
            socketTimeoutMS: 45000, // 45 seconds for socket to timeout
            family: 4, // Force IPv4 (avoids IPv6 DNS issues)
        });
        console.log(`✅ MongoDB Connected: ${mongoose_1.default.connection.host}`);
        mongoose_1.default.connection.on('error', (err) => {
            console.error('❌ MongoDB runtime error:', err.message);
        });
        mongoose_1.default.connection.on('disconnected', () => {
            console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
        });
    }
    catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        console.error('\n📋 Troubleshooting tips:');
        console.error('   1. Try the STANDARD (non-SRV) connection string from Atlas');
        console.error('      Go to Atlas → Connect → Drivers → Select Node.js');
        console.error('      Toggle OFF "Use SRV" to get: mongodb://host1,host2,...');
        console.error('   2. Change your DNS to Google: 8.8.8.8 / 8.8.4.4');
        console.error('   3. Check if your ISP blocks port 27017\n');
        process.exit(1);
    }
});
exports.default = connectDB;
