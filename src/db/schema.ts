import { relations } from 'drizzle-orm';
import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  provider: text('provider').notNull().default('firebase'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const savedAssessments = pgTable('saved_assessments', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  siteLabel: text('site_label').notNull(),
  region: text('region').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  projectType: text('project_type').notNull(),
  areaHectares: integer('area_hectares').notNull(),
  horizonYear: integer('horizon_year').notNull(),
  overallSuitability: integer('overall_suitability').notNull(),
  overallVerdict: text('overall_verdict').notNull(),
  netAvoidedInrCr: doublePrecision('net_avoided_inr_cr').notNull(),
  telemetryJson: text('telemetry_json').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  assessments: many(savedAssessments),
}));

export const savedAssessmentsRelations = relations(savedAssessments, ({ one }) => ({
  author: one(users, {
    fields: [savedAssessments.userId],
    references: [users.id],
  }),
}));
