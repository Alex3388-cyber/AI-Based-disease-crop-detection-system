-- Run as a PostgreSQL administrator and provide secrets using psql variables:
-- psql ... -v api_password='...' -v admin_password='...' -f database/roles.example.sql
-- This file intentionally contains no default credentials.
-- After Django creates its authentication/session tables, grant crop_admin only
-- the explicit CRUD privileges those framework tables require; do not grant
-- blanket privileges on future tables.

\if :{?api_password}
\else
\echo 'Missing required psql variable: api_password'
\quit
\endif

\if :{?admin_password}
\else
\echo 'Missing required psql variable: admin_password'
\quit
\endif

CREATE ROLE crop_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
    PASSWORD :'api_password';
CREATE ROLE crop_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
    PASSWORD :'admin_password';

GRANT CONNECT ON DATABASE :DBNAME TO crop_api, crop_admin;
GRANT USAGE ON SCHEMA public TO crop_api, crop_admin;

GRANT SELECT ON crops, diseases TO crop_api;
GRANT INSERT ON predictions TO crop_api;
GRANT USAGE ON SEQUENCE predictions_id_seq TO crop_api;

GRANT SELECT, INSERT, UPDATE, DELETE ON crops, diseases TO crop_admin;
GRANT SELECT ON predictions TO crop_admin;
GRANT USAGE ON SEQUENCE crops_id_seq, diseases_id_seq TO crop_admin;
