# Generated as Django migration state only. PostgreSQL DDL is owned by database/migrations.

import django.db.models.deletion
import django.core.validators
from django.db import migrations, models
from django.db.models.functions import Lower, Now


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Crop",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=100)),
                ("scientific_name", models.CharField(blank=True, max_length=150, null=True)),
                ("description", models.TextField(blank=True, default="")),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(db_default=Now(), editable=False)),
                ("updated_at", models.DateTimeField(db_default=Now(), editable=False)),
            ],
            options={
                "verbose_name": "crop",
                "verbose_name_plural": "crops",
                "db_table": "crops",
                "ordering": ("name",),
                "managed": False,
                "constraints": [
                    models.UniqueConstraint(
                        Lower("name"),
                        name="crops_name_case_insensitive_uq",
                    ),
                    models.UniqueConstraint(
                        Lower("scientific_name"),
                        condition=models.Q(("scientific_name__isnull", False)),
                        name="crops_scientific_name_case_insensitive_uq",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="Disease",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False)),
                (
                    "model_label",
                    models.CharField(
                        max_length=191,
                        unique=True,
                        validators=[
                            django.core.validators.RegexValidator(
                                message="Use normalized lowercase labels such as crop_disease.",
                                regex="^[a-z0-9]+(?:_[a-z0-9]+)*$",
                            )
                        ],
                    ),
                ),
                ("disease_name", models.CharField(max_length=150)),
                ("description", models.TextField(blank=True, default="")),
                ("symptoms", models.TextField(blank=True, default="")),
                ("management", models.TextField(blank=True, default="")),
                ("prevention", models.TextField(blank=True, default="")),
                ("source_reference", models.TextField(blank=True, null=True)),
                (
                    "content_status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending expert validation"),
                            ("validated", "Validated"),
                            ("retired", "Retired"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(db_default=Now(), editable=False)),
                ("updated_at", models.DateTimeField(db_default=Now(), editable=False)),
                (
                    "crop",
                    models.ForeignKey(
                        db_column="crop_id",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="diseases",
                        to="catalog.crop",
                    ),
                ),
            ],
            options={
                "verbose_name": "disease",
                "verbose_name_plural": "diseases",
                "db_table": "diseases",
                "ordering": ("crop__name", "disease_name"),
                "managed": False,
                "constraints": [
                    models.UniqueConstraint(
                        models.F("crop"),
                        Lower("disease_name"),
                        name="diseases_crop_name_case_insensitive_uq",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="Prediction",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False)),
                ("model_label", models.CharField(max_length=191)),
                ("confidence", models.DecimalField(decimal_places=5, max_digits=6)),
                ("uncertain", models.BooleanField()),
                (
                    "model_version",
                    models.CharField(
                        max_length=100,
                        validators=[
                            django.core.validators.RegexValidator(
                                message="Use a 1-100 character ASCII release identifier.",
                                regex="^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$",
                            )
                        ],
                    ),
                ),
                ("created_at", models.DateTimeField(db_default=Now(), editable=False)),
                (
                    "disease",
                    models.ForeignKey(
                        blank=True,
                        db_column="disease_id",
                        null=True,
                        on_delete=django.db.models.deletion.DO_NOTHING,
                        related_name="predictions",
                        to="catalog.disease",
                    ),
                ),
            ],
            options={
                "verbose_name": "anonymous prediction",
                "verbose_name_plural": "anonymous predictions",
                "db_table": "predictions",
                "ordering": ("-created_at",),
                "managed": False,
            },
        ),
    ]
