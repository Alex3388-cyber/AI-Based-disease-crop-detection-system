from datetime import datetime, timezone

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase
from django.db.models.expressions import DatabaseDefault

from catalog.models import Crop, Disease, Prediction


class CatalogModelTests(SimpleTestCase):
    def setUp(self) -> None:
        self.crop = Crop(id=1, name="Maize", active=True)

    def test_human_readable_names(self) -> None:
        disease = Disease(
            id=2,
            crop=self.crop,
            model_label="maize_demo",
            disease_name="Demo condition",
        )
        prediction = Prediction(id=3, model_label="maize_demo")

        self.assertEqual(str(self.crop), "Maize")
        self.assertEqual(str(disease), "Maize — Demo condition")
        self.assertEqual(str(prediction), "Prediction 3: maize_demo")

    def test_new_rows_use_database_timestamp_defaults(self) -> None:
        crop = Crop(name="Test crop")
        prediction = Prediction(
            model_label="test_crop_healthy",
            confidence=0.8,
            uncertain=False,
            model_version="test-1",
        )

        self.assertIsInstance(crop.created_at, DatabaseDefault)
        self.assertIsInstance(crop.updated_at, DatabaseDefault)
        self.assertIsInstance(prediction.created_at, DatabaseDefault)

    def test_model_label_must_use_normalized_contract(self) -> None:
        field = Disease._meta.get_field("model_label")

        with self.assertRaises(ValidationError):
            field.clean("Maize Leaf Blight", None)

    def test_prediction_model_version_uses_release_identifier_contract(self) -> None:
        field = Prediction._meta.get_field("model_version")

        with self.assertRaises(ValidationError):
            field.clean("release with spaces", None)

    def test_retired_content_cannot_remain_active(self) -> None:
        disease = Disease(
            crop=self.crop,
            model_label="maize_retired",
            disease_name="Retired condition",
            content_status=Disease.ContentStatus.RETIRED,
            active=True,
        )

        with self.assertRaises(ValidationError):
            disease.clean()

    def test_validated_content_requires_source_and_reviewed_text(self) -> None:
        disease = Disease(
            crop=self.crop,
            model_label="maize_demo",
            disease_name="Demo condition",
            content_status=Disease.ContentStatus.VALIDATED,
        )

        with self.assertRaises(ValidationError):
            disease.clean()

    def test_complete_validated_content_passes_clean(self) -> None:
        disease = Disease(
            crop=self.crop,
            model_label="maize_demo",
            disease_name="Demo condition",
            description="Reviewed description",
            symptoms="Reviewed symptoms",
            management="Reviewed management",
            prevention="Reviewed prevention",
            source_reference="https://example.edu/review",
            content_status=Disease.ContentStatus.VALIDATED,
            reviewed_at=datetime.now(timezone.utc),
        )

        disease.clean()

    def test_validated_content_rejects_database_placeholder_guidance(self) -> None:
        placeholder = "Recommendation pending expert/source validation."
        disease = Disease(
            crop=self.crop,
            model_label="maize_demo",
            disease_name="Demo condition",
            description="Reviewed description",
            symptoms="Reviewed symptoms",
            management=placeholder,
            prevention=placeholder,
            source_reference="https://example.edu/review",
            content_status=Disease.ContentStatus.VALIDATED,
            reviewed_at=datetime.now(timezone.utc),
        )

        with self.assertRaises(ValidationError) as context:
            disease.clean()

        self.assertIn("management", context.exception.message_dict)
        self.assertIn("prevention", context.exception.message_dict)

    def test_case_insensitive_constraints_match_sql_contract(self) -> None:
        crop_constraints = {constraint.name for constraint in Crop._meta.constraints}
        disease_constraints = {constraint.name for constraint in Disease._meta.constraints}

        self.assertIn("crops_name_case_insensitive_uq", crop_constraints)
        self.assertIn("crops_scientific_name_case_insensitive_uq", crop_constraints)
        self.assertIn("diseases_crop_name_case_insensitive_uq", disease_constraints)
