/**
 * Central access to configuration. Every secret comes from environment
 * variables (.env.local, never committed); nothing is hard-coded.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

export const env = {
  get mysql() {
    return {
      host: process.env.MYSQL_HOST ?? "127.0.0.1",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: required("MYSQL_USER"),
      password: process.env.MYSQL_PASSWORD ?? "",
      database: required("MYSQL_DATABASE"),
    };
  },
  get mongoUri() {
    return required("MONGODB_URI");
  },
  get mongoDb() {
    return process.env.MONGODB_DB ?? "blood_matcher_logs";
  },
  get authSecret() {
    const secret = required("AUTH_SECRET");
    if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters long.");
    return secret;
  },
  /**
   * The one time zone in which the application decides what "today" is.
   * It is applied to every MySQL session (so CURDATE() and the 90-day rule do
   * not depend on how the database server happens to be configured) and to
   * the MongoDB day/week statistics. A UTC offset such as "+05:30" works on
   * every MySQL and MongoDB installation without extra time-zone tables.
   */
  get timezone() {
    const tz = process.env.APP_TIMEZONE || "+05:30";
    if (!/^[+-]\d{2}:\d{2}$/.test(tz)) {
      throw new Error('APP_TIMEZONE must be a UTC offset like "+05:30".');
    }
    return tz;
  },
};
