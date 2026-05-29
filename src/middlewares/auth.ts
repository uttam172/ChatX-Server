import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    hikeId: string;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; hikeId: string };
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
};
