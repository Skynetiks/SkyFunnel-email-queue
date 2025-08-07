/* eslint-disable @typescript-eslint/no-explicit-any */

export class Debug {
  public static devLog(...args: any[]) {
    if (
      process.env.NODE_ENV === "development" ||
      process.env.SMTP_DEBUG === "true" ||
      process.env.LOGS_DEBUG === "true"
    ) {
      console.log("[DEV]", ...args);
    }
  }

  public static log(...args: any[]) {
    console.log(...args);
  }

  public static error(...args: any[]) {
    console.error(...args);
  }
}
