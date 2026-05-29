import mongoose from 'mongoose';

export interface IMessage extends mongoose.Document {
  senderId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  ciphertext: string;
  iv: string;
  encryptedAesKeySender: string;
  encryptedAesKeyReceiver: string;
  isNudge: boolean;
  createdAt: Date;
}

const messageSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    encryptedAesKeySender: { type: String, required: true },
    encryptedAesKeyReceiver: { type: String, required: true },
    isNudge: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

export const Message = mongoose.model<IMessage>('Message', messageSchema);
