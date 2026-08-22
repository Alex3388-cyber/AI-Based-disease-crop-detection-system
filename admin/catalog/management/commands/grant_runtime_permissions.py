"""Grant bounded PostgreSQL privileges after owner-run migrations.

Run this only from the one-shot migration container/account. The long-running
Express and Django processes receive their separate runtime credentials.
"""

from __future__ import annotations

import os

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from psycopg import sql


def required_role(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise CommandError(f"Required environment variable {name} is not set")
    return value


class Command(BaseCommand):
    help = "Grant least-privilege database access to API and admin runtime roles."

    @transaction.atomic
    def handle(self, *args, **options) -> None:
        if connection.vendor != "postgresql":
            raise CommandError("Runtime permission grants require PostgreSQL")

        api_role = required_role("RUNTIME_API_DATABASE_USER")
        admin_role = required_role("RUNTIME_ADMIN_DATABASE_USER")
        database_name = connection.settings_dict["NAME"]

        with connection.cursor() as cursor:
            cursor.execute("SELECT current_user")
            owner_role = cursor.fetchone()[0]
            if len({owner_role, api_role, admin_role}) != 3:
                raise CommandError(
                    "Migration owner, API, and admin database roles must be distinct"
                )
            cursor.execute(
                """
                SELECT
                    rolname,
                    rolcanlogin,
                    rolsuper,
                    rolcreatedb,
                    rolcreaterole,
                    rolreplication,
                    rolbypassrls
                FROM pg_catalog.pg_roles
                WHERE rolname IN (%s, %s)
                ORDER BY rolname
                """,
                [api_role, admin_role],
            )
            runtime_roles = cursor.fetchall()
            if len(runtime_roles) != 2:
                raise CommandError("Both runtime database roles must already exist")
            for role_name, can_login, *elevated_flags in runtime_roles:
                if not can_login or any(bool(flag) for flag in elevated_flags):
                    raise CommandError(
                        f"Runtime role {role_name} must be LOGIN-only without "
                        "superuser, create, replication, or row-security bypass powers"
                    )
            cursor.execute(
                """
                SELECT member.rolname
                FROM pg_catalog.pg_auth_members membership
                INNER JOIN pg_catalog.pg_roles member
                    ON member.oid = membership.member
                WHERE member.rolname IN (%s, %s)
                LIMIT 1
                """,
                [api_role, admin_role],
            )
            if cursor.fetchone() is not None:
                raise CommandError("Runtime database roles cannot inherit role memberships")

            for role in (api_role, admin_role):
                cursor.execute(
                    sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                        sql.Identifier(database_name), sql.Identifier(role)
                    )
                )
                cursor.execute(
                    sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(
                        sql.Identifier(role)
                    )
                )
                # GRANT is additive. Revoke direct privileges first so rerunning
                # this command also repairs older persistent database volumes.
                cursor.execute(
                    sql.SQL(
                        "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM {}"
                    ).format(sql.Identifier(role))
                )
                cursor.execute(
                    sql.SQL(
                        "REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM {}"
                    ).format(sql.Identifier(role))
                )

            self._grant_tables(
                cursor,
                api_role,
                ("crops", "diseases"),
                "SELECT",
            )
            self._grant_tables(
                cursor,
                api_role,
                ("predictions",),
                "INSERT",
            )
            self._grant_matching_sequences(cursor, api_role, ("predictions",))

            self._grant_tables(
                cursor,
                admin_role,
                ("crops", "diseases"),
                "SELECT, INSERT, UPDATE, DELETE",
            )
            self._grant_tables(cursor, admin_role, ("predictions",), "SELECT")
            self._grant_matching_sequences(cursor, admin_role, ("crops", "diseases"))

            cursor.execute(
                """
                SELECT tablename
                FROM pg_catalog.pg_tables
                WHERE schemaname = 'public'
                  AND (
                    tablename LIKE 'auth\\_%' ESCAPE '\\'
                    OR tablename LIKE 'django\\_%' ESCAPE '\\'
                    OR tablename LIKE 'axes\\_%' ESCAPE '\\'
                  )
                ORDER BY tablename
                """
            )
            framework_tables = tuple(row[0] for row in cursor.fetchall())
            self._grant_tables(
                cursor,
                admin_role,
                framework_tables,
                "SELECT, INSERT, UPDATE, DELETE",
            )
            self._grant_matching_sequences(
                cursor,
                admin_role,
                ("auth", "django", "axes"),
            )

        self.stdout.write(
            self.style.SUCCESS("Granted bounded API and Django runtime privileges.")
        )

    @staticmethod
    def _grant_tables(cursor, role: str, table_names: tuple[str, ...], privileges: str) -> None:
        for table_name in table_names:
            cursor.execute(
                sql.SQL("GRANT {} ON TABLE {} TO {}").format(
                    sql.SQL(privileges),
                    sql.Identifier("public", table_name),
                    sql.Identifier(role),
                )
            )

    @staticmethod
    def _grant_matching_sequences(cursor, role: str, prefixes: tuple[str, ...]) -> None:
        cursor.execute(
            """
            SELECT sequencename
            FROM pg_catalog.pg_sequences
            WHERE schemaname = 'public'
            ORDER BY sequencename
            """
        )
        for (sequence_name,) in cursor.fetchall():
            if sequence_name.startswith(prefixes):
                cursor.execute(
                    sql.SQL("GRANT USAGE ON SEQUENCE {} TO {}").format(
                        sql.Identifier("public", sequence_name),
                        sql.Identifier(role),
                    )
                )
