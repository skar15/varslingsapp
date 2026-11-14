-- Runs once when the PostGIS volume is first created: a separate database for `pnpm test`.
-- The tests drop and recreate its schema, so it must never be the development database.
create database varsling_test;
