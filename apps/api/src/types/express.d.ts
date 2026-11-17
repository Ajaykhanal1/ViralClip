import type { AuthPrincipal } from '../modules/auth/auth.security.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPrincipal;
    }
  }
}

export {};
