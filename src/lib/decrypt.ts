import crypto from "crypto";
import { AppError } from "./errorHandler";

export function decryptToken(encryptedText: string): string {
  if (!encryptedText) throw new AppError("BAD_REQUEST", "Password for sender identity not provided");
  if (!process.env.ENCRYPTION_SECRET) throw new Error("ENCRYPTION_SECRET is required for decryption");

  const key = Buffer.from(process.env.ENCRYPTION_SECRET, "hex");
  if (key.length !== 32) throw new Error("Secret key must be 32 bytes long");

  const [ivHex, encryptedHex] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encryptedTextBuffer = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

  let decrypted = decipher.update(encryptedTextBuffer);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}