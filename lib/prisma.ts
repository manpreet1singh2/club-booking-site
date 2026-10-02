import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// engineType = "client" (see schema.prisma): queries run through the pure-JS/WASM query compiler
// and the `pg` driver, so no native Prisma engine binary has to ship with the app.
//
// The client is created lazily on first use. Next.js imports every route module during
// `next build` ("Collecting page data"); creating the client at import time would make the
// build fail whenever DATABASE_URL is not available in the build environment.
function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient();
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
