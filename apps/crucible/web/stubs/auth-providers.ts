/**
 * Browser stub for server-side auth providers
 * These providers use KMS/server features and are not available in browser
 */

export const FarcasterProvider = {
  name: 'farcaster',
  async authenticate() {
    throw new Error('Farcaster auth requires server-side support')
  },
}

export const EmailProvider = {
  name: 'email',
  async sendCode() {
    throw new Error('Email auth requires server-side support')
  },
  async verify() {
    throw new Error('Email auth requires server-side support')
  },
}

export const PhoneProvider = {
  name: 'phone',
  async sendCode() {
    throw new Error('Phone auth requires server-side support')
  },
  async verify() {
    throw new Error('Phone auth requires server-side support')
  },
}

export default {}
