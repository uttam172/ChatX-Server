import mongoose from 'mongoose';

export interface IUser extends mongoose.Document {
  email: string;
  passwordHash: string;
  hikeId: string;
  publicKey: string;
  hiddenPinHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    hikeId: { type: String, required: true, unique: true },
    publicKey: { type: String, required: true },
    hiddenPinHash: { type: String },
  },
  {
    timestamps: true,
  }
);

export const User = mongoose.model<IUser>('User', userSchema);
