from django.contrib import admin

from .models import Crop, Disease, Prediction


@admin.register(Crop)
class CropAdmin(admin.ModelAdmin):
    list_display = ("name", "scientific_name", "active", "updated_at")
    list_filter = ("active",)
    search_fields = ("name", "scientific_name")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("name",)
    list_per_page = 50


@admin.register(Disease)
class DiseaseAdmin(admin.ModelAdmin):
    list_display = (
        "disease_name",
        "crop",
        "model_label",
        "content_status",
        "active",
        "updated_at",
    )
    list_filter = ("content_status", "active", "crop")
    search_fields = ("disease_name", "model_label", "crop__name")
    autocomplete_fields = ("crop",)
    readonly_fields = ("created_at", "updated_at")
    list_select_related = ("crop",)
    list_per_page = 50
    fieldsets = (
        ("Model mapping", {"fields": ("crop", "model_label", "disease_name", "active")}),
        ("Farmer-facing information", {"fields": ("description", "symptoms", "management", "prevention")}),
        ("Editorial validation", {"fields": ("source_reference", "content_status", "reviewed_at")}),
        ("Audit timestamps", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )


@admin.register(Prediction)
class PredictionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "model_label",
        "disease",
        "confidence",
        "uncertain",
        "model_version",
        "created_at",
    )
    list_filter = ("uncertain", "model_version", "created_at")
    search_fields = ("model_label", "disease__disease_name")
    readonly_fields = (
        "id",
        "disease",
        "model_label",
        "confidence",
        "uncertain",
        "model_version",
        "created_at",
    )
    list_select_related = ("disease",)
    date_hierarchy = "created_at"
    list_per_page = 100

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
