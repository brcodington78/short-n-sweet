import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// Creates the User row on first authenticated request if it doesn't exist yet.
// Call this at the top of any route handler that needs the DB user record.
export async function ensureUser(clerkUserId: string) {
  const clerkUser = await currentUser();
  if (!clerkUser) throw new Error("Clerk user not found");

  const email = clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("Clerk user has no email address");

  return prisma.user.upsert({
    where: { id: clerkUserId },
    create: { id: clerkUserId, email },
    update: {},
  });
}
