-- The account the backend uses can only read. This is the guard that cannot be bypassed.
CREATE ROLE report_reader LOGIN PASSWORD 'reader-password-change-me';
GRANT CONNECT ON DATABASE shop TO report_reader;
GRANT USAGE ON SCHEMA public TO report_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO report_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO report_reader;
