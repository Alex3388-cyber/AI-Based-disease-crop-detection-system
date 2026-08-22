"""Query-backed checks that ModelForms reject case-only duplicates cleanly."""

from unittest import skipUnless

from django.core.exceptions import ValidationError
from django.db import connection
from django.test import TransactionTestCase

from catalog.models import Crop, Disease


@skipUnless(connection.vendor == "sqlite", "The isolated unmanaged-table fixture targets SQLite.")
class CaseInsensitiveFormValidationTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        with connection.schema_editor() as schema_editor:
            schema_editor.create_model(Crop)
            schema_editor.create_model(Disease)

    @classmethod
    def tearDownClass(cls) -> None:
        with connection.schema_editor() as schema_editor:
            schema_editor.delete_model(Disease)
            schema_editor.delete_model(Crop)
        super().tearDownClass()

    def setUp(self) -> None:
        # Django's flush command intentionally skips unmanaged tables, so keep
        # this isolated schema deterministic between test methods ourselves.
        Disease.objects.all().delete()
        Crop.objects.all().delete()

    def test_crop_name_case_only_duplicate_fails_full_clean(self) -> None:
        Crop.objects.create(name="Maize")

        with self.assertRaises(ValidationError):
            Crop(name="maize").full_clean()

    def test_scientific_name_case_only_duplicate_fails_full_clean(self) -> None:
        Crop.objects.create(name="Maize", scientific_name="Zea mays")

        with self.assertRaises(ValidationError):
            Crop(name="Other", scientific_name="zea MAYS").full_clean()

    def test_disease_name_is_unique_per_crop_ignoring_case(self) -> None:
        crop = Crop.objects.create(name="Maize")
        Disease.objects.create(
            crop=crop,
            model_label="maize_rust",
            disease_name="Rust",
        )

        duplicate = Disease(
            crop=crop,
            model_label="maize_other_rust",
            disease_name="rUsT",
        )
        with self.assertRaises(ValidationError):
            duplicate.full_clean()
