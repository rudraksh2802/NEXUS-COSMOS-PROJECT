import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { savedAssessments } from './schema.ts';

export interface SaveAssessmentInput {
  userId: number;
  siteLabel: string;
  region: string;
  lat: number;
  lng: number;
  projectType: string;
  areaHectares: number;
  horizonYear: number;
  overallSuitability: number;
  overallVerdict: string;
  netAvoidedInrCr: number;
  telemetryJson: string;
}

export async function listUserAssessments(userId: number) {
  try {
    return await db
      .select()
      .from(savedAssessments)
      .where(eq(savedAssessments.userId, userId))
      .orderBy(desc(savedAssessments.createdAt))
      .limit(25);
  } catch (error) {
    console.error('Failed to query saved assessments:', error);
    throw new Error('Failed to load saved site assessments.', { cause: error });
  }
}

export async function createUserAssessment(input: SaveAssessmentInput) {
  try {
    const rows = await db
      .insert(savedAssessments)
      .values(input)
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Failed to save assessment:', error);
    throw new Error('Failed to save site assessment.', { cause: error });
  }
}

export async function deleteUserAssessment(userId: number, assessmentId: number) {
  try {
    const rows = await db
      .delete(savedAssessments)
      .where(and(eq(savedAssessments.id, assessmentId), eq(savedAssessments.userId, userId)))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to delete assessment:', error);
    throw new Error('Failed to remove saved assessment.', { cause: error });
  }
}
