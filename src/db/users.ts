import { db } from './index.ts';
import { users } from './schema.ts';

export async function getOrCreateUser(uid: string, email: string, provider = 'firebase') {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        provider,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          provider,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}
