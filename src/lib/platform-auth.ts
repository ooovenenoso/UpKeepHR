import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { db } from "./db";
import { appUrl, authSecret, localMode } from "./config";

export const platformAuth = betterAuth({
  appName: "UpKeepHR",
  baseURL: appUrl,
  secret: authSecret,
  trustedOrigins: [appUrl],
  database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128 },
  user: { modelName: "PlatformUser", additionalFields: { role: { type: "string", defaultValue: "EMPLOYEE", input: false }, active: { type: "boolean", defaultValue: true, input: false } }, changeEmail: { enabled: false } },
  session: { modelName: "AuthSession", expiresIn: 8 * 3600, disableSessionRefresh: true, cookieCache: { enabled: false } },
  account: { modelName: "AuthAccount" },
  verification: { modelName: "AuthVerification" },
  rateLimit: { enabled: true, storage: "database", modelName: "AuthRateLimit", window: 60, max: 10 },
  advanced: { cookiePrefix: "hhrr", useSecureCookies: !localMode },
  databaseHooks:{session:{create:{before:async session=>{const user=await db.platformUser.findUnique({where:{id:session.userId},include:{employee:true}});if(!user?.active||(user.employee&&!user.employee.active))return false;return {data:session};}}}},
  plugins: [twoFactor({ issuer: "UpKeepHR", twoFactorTable: "TwoFactor", accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 } })],
});
