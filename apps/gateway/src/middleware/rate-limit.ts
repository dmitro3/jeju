/**
 * Express Rate Limiter using rate-limiter-flexible
 * Replaces custom implementation with battle-tested library
 */

import type { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';

interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
  skipPaths?: string[];
  message?: string;
}

/**
 * Extracts client IP address safely.
 * 
 * SECURITY: X-Forwarded-For can be spoofed by clients.
 * When behind a trusted reverse proxy (nginx, cloudflare), configure Express with:
 *   app.set('trust proxy', 1) // trust first proxy
 * This makes req.ip return the correct client IP.
 * 
 * Without trust proxy configured, req.ip returns the direct connection IP.
 * We only fall back to X-Forwarded-For header as last resort, taking the 
 * rightmost (most recently added) IP which is typically from our proxy.
 */
function getClientIp(req: Request): string {
  // When trust proxy is configured, Express's req.ip is the best source
  if (req.ip && req.ip !== '::1' && req.ip !== '127.0.0.1') {
    return req.ip;
  }
  
  // X-Real-IP is typically set by nginx and is more trustworthy
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp) {
    return realIp.trim();
  }
  
  // For X-Forwarded-For, we take the rightmost non-private IP
  // The rightmost IP is the one added by our most trusted proxy
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor) {
    // Split and reverse to get rightmost first
    const ips = forwardedFor.split(',').map(ip => ip.trim()).reverse();
    for (const ip of ips) {
      // Skip private/local IPs that could be spoofed
      if (ip && !isPrivateIp(ip)) {
        return ip;
      }
    }
    // If all IPs are private, use the last one (closest to us)
    if (ips[0]) return ips[0];
  }
  
  return req.ip || 'unknown';
}

/**
 * Check if an IP is a private/local address
 */
function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges and localhost
  if (ip.startsWith('10.') || 
      ip.startsWith('192.168.') || 
      ip.startsWith('127.') ||
      ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') ||
      ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') ||
      ip.startsWith('172.20.') ||
      ip.startsWith('172.21.') ||
      ip.startsWith('172.22.') ||
      ip.startsWith('172.23.') ||
      ip.startsWith('172.24.') ||
      ip.startsWith('172.25.') ||
      ip.startsWith('172.26.') ||
      ip.startsWith('172.27.') ||
      ip.startsWith('172.28.') ||
      ip.startsWith('172.29.') ||
      ip.startsWith('172.30.') ||
      ip.startsWith('172.31.') ||
      ip === 'localhost' ||
      ip === '::1') {
    return true;
  }
  return false;
}

const DEFAULT_OPTIONS: Required<RateLimitOptions> = {
  windowMs: 60 * 1000,
  maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 1000,
  keyGenerator: getClientIp,
  skipPaths: ['/health', '/.well-known/agent-card.json'],
  message: 'Too many requests, please try again later',
};

export function rateLimit(options: RateLimitOptions = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  const limiter = new RateLimiterMemory({
    points: config.maxRequests,
    duration: Math.ceil(config.windowMs / 1000),
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (config.skipPaths.some(path => req.path.startsWith(path))) {
      next();
      return;
    }

    const key = config.keyGenerator(req);

    try {
      const result = await limiter.consume(key);
      
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + Math.ceil(result.msBeforeNext / 1000));
      
      next();
    } catch (rejRes) {
      const rateLimiterRes = rejRes as { msBeforeNext: number; remainingPoints: number };
      const retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000);
      
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + retryAfter);
      res.setHeader('Retry-After', retryAfter);
      
      res.status(429).json({
        error: 'Too Many Requests',
        message: config.message,
        retryAfter,
      });
    }
  };
}

export function strictRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000,
    maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 200,
    message: 'Rate limit exceeded for write operations',
  });
}

export function agentRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000,
    maxRequests: process.env.NODE_ENV === 'test' ? 10000 : 500,
    keyGenerator: (req) => (req.headers['x-agent-id'] as string) || req.ip || 'unknown',
  });
}
