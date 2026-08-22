#!/bin/sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${DATABASE_USER:?DATABASE_USER is required}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}"
: "${DJANGO_DATABASE_USER:?DJANGO_DATABASE_USER is required}"
: "${DJANGO_DATABASE_PASSWORD:?DJANGO_DATABASE_PASSWORD is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

case "$DATABASE_USER" in
  ""|[0-9]*|*[!A-Za-z0-9_]*)
    echo "DATABASE_USER is not a valid PostgreSQL role name" >&2; exit 1 ;;
esac
case "$DJANGO_DATABASE_USER" in
  ""|[0-9]*|*[!A-Za-z0-9_]*)
    echo "DJANGO_DATABASE_USER is not a valid PostgreSQL role name" >&2; exit 1 ;;
esac

if [ "$DATABASE_USER" = "$DJANGO_DATABASE_USER" ] || \
   [ "$DATABASE_USER" = "$POSTGRES_USER" ] || \
   [ "$DJANGO_DATABASE_USER" = "$POSTGRES_USER" ]; then
  echo "Owner, API, and Django database role names must all be distinct" >&2
  exit 1
fi

if [ "${#DATABASE_PASSWORD}" -lt 16 ] || \
   [ "${#DJANGO_DATABASE_PASSWORD}" -lt 16 ] || \
   [ "${#POSTGRES_PASSWORD}" -lt 16 ]; then
  echo "Database passwords must contain at least 16 characters" >&2
  exit 1
fi

if [ "$DATABASE_PASSWORD" = "$DJANGO_DATABASE_PASSWORD" ] || \
   [ "$DATABASE_PASSWORD" = "$POSTGRES_PASSWORD" ] || \
   [ "$DJANGO_DATABASE_PASSWORD" = "$POSTGRES_PASSWORD" ]; then
  echo "Owner, API, and Django database passwords must all be distinct" >&2
  exit 1
fi

for candidate in "$DATABASE_PASSWORD" "$DJANGO_DATABASE_PASSWORD" "$POSTGRES_PASSWORD"; do
  normalized=$(printf '%s' "$candidate" | tr '[:upper:]' '[:lower:]')
  case "$normalized" in
    *change_me*|*change-me*|*change_to*|*changeto*|*placeholder*)
      echo "Known placeholder database passwords are forbidden" >&2
      exit 1
      ;;
  esac
done

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=api_role="$DATABASE_USER" \
  --set=api_password="$DATABASE_PASSWORD" \
  --set=admin_role="$DJANGO_DATABASE_USER" \
  --set=admin_password="$DJANGO_DATABASE_PASSWORD" <<-'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'api_role', :'api_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'api_role')
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'admin_role', :'admin_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'admin_role')
\gexec
SQL
