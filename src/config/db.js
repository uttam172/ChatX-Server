const mongoose = require('mongoose');

const connectDB = async () => {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
        console.error('❌ MONGODB_URI is not defined in your .env file!');
        process.exit(1);
    }

    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 10000,   // 10 seconds to find a server
            connectTimeoutMS: 10000,           // 10 seconds to establish connection
            socketTimeoutMS: 45000,            // 45 seconds for socket to timeout
            family: 4,                         // Force IPv4 (avoids IPv6 DNS issues)
        });

        console.log(`✅ MongoDB Connected: ${mongoose.connection.host}`);

        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB runtime error:', err.message);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
        });

    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        console.error('\n📋 Troubleshooting tips:');
        console.error('   1. Try the STANDARD (non-SRV) connection string from Atlas');
        console.error('      Go to Atlas → Connect → Drivers → Select Node.js');
        console.error('      Toggle OFF "Use SRV" to get: mongodb://host1,host2,...');
        console.error('   2. Change your DNS to Google: 8.8.8.8 / 8.8.4.4');
        console.error('   3. Check if your ISP blocks port 27017\n');
        process.exit(1);
    }
};

module.exports = connectDB;
