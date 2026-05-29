import mongoose from 'mongoose';

export interface IChatSettings extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  peerId: mongoose.Types.ObjectId;
  isHidden: boolean;
}

const chatSettingsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    peerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isHidden: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

// Ensure a user can only have one settings record per peer
chatSettingsSchema.index({ userId: 1, peerId: 1 }, { unique: true });

export const ChatSettings = mongoose.model<IChatSettings>('ChatSettings', chatSettingsSchema);
