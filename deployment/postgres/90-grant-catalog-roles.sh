#!/bin/sh
set -eu

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=api_role="$DATABASE_USER" \
  --set=admin_role="$DJANGO_DATABASE_USER" <<-'SQL'
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'api_role')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'api_role')
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON TABLE crops, diseases, predictions FROM %I',
  :'api_role'
)
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON SEQUENCE crops_id_seq, diseases_id_seq, predictions_id_seq FROM %I',
  :'api_role'
)
\gexec
SELECT format('GRANT SELECT ON TABLE crops, diseases TO %I', :'api_role')
\gexec
SELECT format('GRANT INSERT ON TABLE predictions TO %I', :'api_role')
\gexec
SELECT format('GRANT USAGE ON SEQUENCE predictions_id_seq TO %I', :'api_role')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'admin_role')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'admin_role')
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON TABLE crops, diseases, predictions FROM %I',
  :'admin_role'
)
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON SEQUENCE crops_id_seq, diseases_id_seq, predictions_id_seq FROM %I',
  :'admin_role'
)
\gexec
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE crops, diseases TO %I',
  :'admin_role'
)
\gexec
SELECT format('GRANT SELECT ON TABLE predictions TO %I', :'admin_role')
\gexec
SELECT format(
  'GRANT USAGE ON SEQUENCE crops_id_seq, diseases_id_seq TO %I',
  :'admin_role'
)
\gexec
SQL
