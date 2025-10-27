import crypto from "crypto";

type BasePayload = {
  exp: number;
  iat: number;
};

export type UnsubscribeTokenPayload = {
  email: string;
  recipientType: "CLIENT" | "LEAD";
  leadId?: string | null;
  clientId?: string | null;
  campaignId: string;
  type: "unsubscribe" | "subscribe";
  reason: string;
};

type UnsignedTokenPayload<T> = Omit<T, "exp" | "iat">;

export function generateUnsubscribeToken<T extends Record<string, unknown>>(
  payload: UnsignedTokenPayload<T>,
  expiresInHours = 24,
): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not defined");
  const iat = Math.floor(Date.now() / 1000); // seconds
  const exp = iat + expiresInHours * 60 * 60;

  const fullPayload = { ...payload, exp, iat };
  const data = JSON.stringify(fullPayload);
  const signature = crypto.createHmac("sha256", secret).update(data).digest("hex");

  const token = {
    data,
    signature,
  };

  return Buffer.from(JSON.stringify(token)).toString("base64url");
}

export function verifyUnsubscribeToken<T extends BasePayload>(token: string): T {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not defined");
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString();
  } catch {
    throw new Error("Token is not valid base64url");
  }

  let parsed: { data: string; signature: string };
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("Malformed token structure");
  }

  const { data, signature } = parsed;

  const expectedSignature = crypto.createHmac("sha256", secret).update(data).digest("hex");
  if (signature !== expectedSignature) {
    throw new Error("Invalid signature");
  }

  let payload: T;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new Error("Invalid token payload");
  }

  const now = Math.floor(Date.now() / 1000); // seconds
  if (payload.exp && now > payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
}
