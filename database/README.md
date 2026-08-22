# Database

The PostgreSQL schema is migration-first and contains no image data or personal
information. Apply it with `psql -v ON_ERROR_STOP=1 -f schema.sql`, then apply
`seeds/001_demo_unvalidated.sql` only when an inactive demonstration record is
useful. The seed is intentionally not a real model class or agricultural claim.

Use a dedicated migration owner to apply migrations. `roles.example.sql` shows
separate least-privilege runtime roles for the public API and Django Admin; pass
passwords as psql variables rather than placing them in this repository.

Verify a migrated database with
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/001_schema_contract.sql` from
this directory. In PowerShell, reference `$env:DATABASE_URL`. The verification
transaction always rolls back.

Rollback migration 001 only on a disposable database because it removes all
three application tables.
