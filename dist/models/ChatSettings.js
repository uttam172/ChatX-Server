"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatSettings = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const chatSettingsSchema = new mongoose_1.default.Schema({
    userId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
    peerId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
    isHidden: { type: Boolean, default: false },
}, {
    timestamps: true,
});
// Ensure a user can only have one settings record per peer
chatSettingsSchema.index({ userId: 1, peerId: 1 }, { unique: true });
exports.ChatSettings = mongoose_1.default.model('ChatSettings', chatSettingsSchema);
