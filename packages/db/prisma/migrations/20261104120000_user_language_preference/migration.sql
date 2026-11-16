CREATE TYPE "user_language" AS ENUM ('en', 'te', 'hi');

ALTER TABLE users
  ADD COLUMN preferred_language "user_language" NOT NULL DEFAULT 'en';
