export interface RegisterRequest { email: string; password: string; }
export interface LoginRequest { identifier: string; password: string; }
export interface RefreshRequest { refreshToken: string; }
