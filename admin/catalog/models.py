"""Django mappings for tables owned by the SQL migration layer."""

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.db.models.functions import Lower, Now


MODEL_LABEL_VALIDATOR = RegexValidator(
    regex=r"^[a-z0-9]+(?:_[a-z0-9]+)*$",
    message="Use normalized lowercase labels such as crop_disease.",
)
MODEL_VERSION_VALIDATOR = RegexValidator(
    regex=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$",
    message="Use a 1-100 character ASCII release identifier.",
)


class Crop(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=100)
    scientific_name = models.CharField(max_length=150, blank=True, null=True)
    description = models.TextField(blank=True, default="")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(db_default=Now(), editable=False)
    updated_at = models.DateTimeField(db_default=Now(), editable=False)

    class Meta:
        managed = False
        db_table = "crops"
        ordering = ("name",)
        verbose_name = "crop"
        verbose_name_plural = "crops"
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                name="crops_name_case_insensitive_uq",
            ),
            models.UniqueConstraint(
                Lower("scientific_name"),
                condition=models.Q(scientific_name__isnull=False),
                name="crops_scientific_name_case_insensitive_uq",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class Disease(models.Model):
    class ContentStatus(models.TextChoices):
        PENDING = "pending", "Pending expert validation"
        VALIDATED = "validated", "Validated"
        RETIRED = "retired", "Retired"

    id = models.BigAutoField(primary_key=True)
    crop = models.ForeignKey(
        Crop,
        db_column="crop_id",
        on_delete=models.PROTECT,
        related_name="diseases",
    )
    model_label = models.CharField(
        max_length=191,
        unique=True,
        validators=[MODEL_LABEL_VALIDATOR],
    )
    disease_name = models.CharField(max_length=150)
    description = models.TextField(blank=True, default="")
    symptoms = models.TextField(blank=True, default="")
    management = models.TextField(blank=True, default="")
    prevention = models.TextField(blank=True, default="")
    source_reference = models.TextField(blank=True, null=True)
    content_status = models.CharField(
        max_length=20,
        choices=ContentStatus.choices,
        default=ContentStatus.PENDING,
    )
    reviewed_at = models.DateTimeField(blank=True, null=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(db_default=Now(), editable=False)
    updated_at = models.DateTimeField(db_default=Now(), editable=False)

    class Meta:
        managed = False
        db_table = "diseases"
        ordering = ("crop__name", "disease_name")
        verbose_name = "disease"
        verbose_name_plural = "diseases"
        constraints = [
            models.UniqueConstraint(
                models.F("crop"),
                Lower("disease_name"),
                name="diseases_crop_name_case_insensitive_uq",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.crop.name} — {self.disease_name}"

    def clean(self) -> None:
        super().clean()
        if self.content_status == self.ContentStatus.RETIRED and self.active:
            raise ValidationError("Retired disease content must be inactive.")
        if self.content_status == self.ContentStatus.VALIDATED:
            missing = []
            for field_name in (
                "description",
                "symptoms",
                "management",
                "prevention",
                "source_reference",
            ):
                if not (getattr(self, field_name, "") or "").strip():
                    missing.append(field_name.replace("_", " "))
            if missing:
                raise ValidationError(
                    "Validated content requires: " + ", ".join(missing) + "."
                )
            if self.reviewed_at is None:
                raise ValidationError("Validated content requires a review timestamp.")
            placeholder = "Recommendation pending expert/source validation."
            placeholder_fields = [
                field_name
                for field_name in ("management", "prevention")
                if getattr(self, field_name) == placeholder
            ]
            if placeholder_fields:
                raise ValidationError(
                    {
                        field_name: "Replace placeholder text before validating content."
                        for field_name in placeholder_fields
                    }
                )


class Prediction(models.Model):
    id = models.BigAutoField(primary_key=True)
    disease = models.ForeignKey(
        Disease,
        db_column="disease_id",
        # PostgreSQL owns the ON DELETE SET NULL action. DO_NOTHING prevents
        # Django's collector from requiring UPDATE permission on predictions.
        on_delete=models.DO_NOTHING,
        related_name="predictions",
        blank=True,
        null=True,
    )
    model_label = models.CharField(max_length=191)
    confidence = models.DecimalField(max_digits=6, decimal_places=5)
    uncertain = models.BooleanField()
    model_version = models.CharField(
        max_length=100,
        validators=[MODEL_VERSION_VALIDATOR],
    )
    created_at = models.DateTimeField(db_default=Now(), editable=False)

    class Meta:
        managed = False
        db_table = "predictions"
        ordering = ("-created_at",)
        verbose_name = "anonymous prediction"
        verbose_name_plural = "anonymous predictions"

    def __str__(self) -> str:
        return f"Prediction {self.pk}: {self.model_label}"
