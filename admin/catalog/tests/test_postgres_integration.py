"""Opt-in contract tests against Django's disposable PostgreSQL test database.

The catalog models are deliberately unmanaged because the SQL migration layer owns
their tables.  Django therefore cannot create them while building a test database;
this suite applies the authoritative migration before exercising the ORM.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest import SkipTest

from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test import TransactionTestCase

from catalog.models import Crop, Disease, Prediction


RUN_POSTGRES_CONTRACT = os.getenv("ADMIN_INTEGRATION_DATABASE", "").lower() in {
    "1",
    "true",
    "yes",
}
SCHEMA_PATH = (
    Path(__file__).resolve().parents[3]
    / "database"
    / "migrations"
    / "001_initial_schema.sql"
)


class PostgreSqlCatalogContractTests(TransactionTestCase):
    """Exercise unmanaged models against the real PostgreSQL schema contract."""

    @classmethod
    def setUpClass(cls) -> None:
        if not RUN_POSTGRES_CONTRACT:
            raise SkipTest(
                "Set ADMIN_INTEGRATION_DATABASE=true to run PostgreSQL contract tests."
            )
        if connection.vendor != "postgresql":
            raise SkipTest("PostgreSQL contract tests require the PostgreSQL backend.")

        connection.ensure_connection()
        database_name = str(connection.settings_dict["NAME"])
        if not database_name.startswith("test_"):
            raise RuntimeError(
                "Refusing to apply the raw schema outside a disposable test_ database."
            )

        schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
        raw_connection = connection.connection
        if raw_connection is None:  # pragma: no cover - guarded by ensure_connection
            raise RuntimeError("Django did not establish a PostgreSQL connection.")
        with raw_connection.cursor() as cursor:
            # Psycopg's simple-query protocol accepts the migration as one coherent
            # transaction, including its PL/pgSQL function body.
            cursor.execute(schema_sql, prepare=False)

        super().setUpClass()

    def test_database_defaults_and_update_trigger_work_through_orm(self) -> None:
        crop = Crop.objects.create(name="Integration maize")

        self.assertIsNotNone(crop.created_at)
        self.assertIsNotNone(crop.updated_at)
        original_updated_at = crop.updated_at

        crop.description = "Updated through Django"
        crop.save(update_fields=["description"])
        crop.refresh_from_db()

        self.assertGreaterEqual(crop.updated_at, original_updated_at)

    def test_case_insensitive_uniqueness_is_visible_before_and_at_save(self) -> None:
        Crop.objects.create(name="Cassava", scientific_name="Manihot esculenta")
        duplicate = Crop(name="cassava", scientific_name="MANIHOT ESCULENTA")

        with self.assertRaises(ValidationError):
            duplicate.full_clean()

        with self.assertRaises(IntegrityError), transaction.atomic():
            duplicate.save(force_insert=True)

    def test_database_fk_action_nulls_prediction_without_django_update(self) -> None:
        crop = Crop.objects.create(name="Tomato")
        disease = Disease.objects.create(
            crop=crop,
            model_label="tomato_healthy",
            disease_name="Healthy",
        )
        prediction = Prediction.objects.create(
            disease=disease,
            model_label=disease.model_label,
            confidence="0.99000",
            uncertain=False,
            model_version="integration-1",
        )

        disease.delete()
        prediction.refresh_from_db()

        self.assertIsNone(prediction.disease_id)
