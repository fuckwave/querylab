/**
 * Application configuration
 * 
 * This file contains all configuration constants for the application.
 * 
 * To configure the API URL, you have two options:
 * 
 * Option 1: Set it directly here (recommended for quick setup)
 *   - Change the API_URL value below to your Workers API URL
 * 
 * Option 2: Use environment variable (recommended for production)
 *   - Set NEXT_PUBLIC_API_URL in your .env.local file (for local dev)
 *   - Set NEXT_PUBLIC_API_URL in Cloudflare Pages environment variables (for production)
 *   - Environment variable takes precedence over the value set here
 */

// ============================================
// API Configuration
// ============================================
// Set your Cloudflare Workers API URL here, or use NEXT_PUBLIC_API_URL env var
// For local development: http://localhost:8787
// For production: https://your-api.workers.dev
const DEFAULT_API_URL = 'http://localhost:8787';

export const config = {
  /**
   * Cloudflare Workers API URL for the share feature
   * 
   * Priority order:
   * 1. NEXT_PUBLIC_API_URL environment variable (if set)
   * 2. The DEFAULT_API_URL constant above
   * 
   * Note: With Next.js static export (output: "export"), NEXT_PUBLIC_* env vars
   * are embedded at BUILD TIME into the JavaScript bundle. This means:
   * - They work on Cloudflare Pages (baked into static files)
   * - You must set them in Cloudflare Pages build environment variables
   * - They cannot be changed at runtime (they're part of the built files)
   */
  API_URL: (() => {
    // Check for environment variable (works in both server and client)
    // In static export, NEXT_PUBLIC_* vars are replaced at build time
    const envUrl = process.env.NEXT_PUBLIC_API_URL;
    
    if (envUrl && envUrl.trim()) {
      return envUrl.trim();
    }
    
    // Fall back to the default URL set above
    const apiUrl = DEFAULT_API_URL;
    
    // Log warning if using default (only in browser, not during build)
    if (typeof window !== 'undefined' && typeof console !== 'undefined') {
      console.warn(
        '%c⚠️ API URL not configured',
        'color: orange; font-weight: bold; font-size: 14px;'
      );
      console.warn(
        'The share feature requires a Cloudflare Workers API.\n' +
        '\nTo configure it:\n' +
        '1. Update DEFAULT_API_URL in src/lib/config.ts, OR\n' +
        '2. Set NEXT_PUBLIC_API_URL in .env.local (local) or Cloudflare Pages env vars (production)\n' +
        `\nCurrently using: ${apiUrl}`
      );
    }
    
    return apiUrl;
  })(),
} as const;

/**
 * Check if the API URL is the default localhost URL
 */
export function isDefaultApiUrl(): boolean {
  return config.API_URL === 'http://localhost:8787';
}

/**
 * Check if the API is properly configured (not localhost or not set)
 */
export function isApiConfigured(): boolean {
  const url = config.API_URL;
  // Check if it's localhost and we're in production (not localhost origin)
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    if (typeof window !== 'undefined') {
      const isLocalhost = window.location.hostname === 'localhost' || 
                         window.location.hostname === '127.0.0.1';
      return isLocalhost; // Only valid if we're also on localhost
    }
    return false; // localhost API in production is not configured
  }
  return true; // Non-localhost URL is configured
}

