"""Only the restricted Django administration route is exposed."""

import os
import re

from django.contrib import admin
from django.core.exceptions import ImproperlyConfigured
from django.urls import path


admin.site.site_header = "Crop Disease Content Administration"
admin.site.site_title = "Crop Disease Admin"
admin.site.index_title = "Knowledge base management"

def configured_admin_path(value: str) -> str:
    candidate = value.strip("/")
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", candidate) is None:
        raise ImproperlyConfigured(
            "DJANGO_ADMIN_PATH must be one non-empty URL-safe path segment"
        )
    return candidate


admin_path = configured_admin_path(os.getenv("DJANGO_ADMIN_PATH", "admin"))
urlpatterns = [path(f"{admin_path}/", admin.site.urls)]
