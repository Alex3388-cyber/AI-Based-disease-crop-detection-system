"""Create least-privilege administration groups without creating any users."""

from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Create/update the Content manager group with scoped catalog permissions."

    @transaction.atomic
    def handle(self, *args, **options) -> None:
        group, created = Group.objects.get_or_create(name="Content manager")
        permissions = Permission.objects.filter(
            content_type__app_label="catalog",
            codename__in=(
                "add_crop",
                "change_crop",
                "view_crop",
                "add_disease",
                "change_disease",
                "view_disease",
                "view_prediction",
            ),
        )
        group.permissions.set(permissions)
        action = "Created" if created else "Updated"
        self.stdout.write(self.style.SUCCESS(f"{action} Content manager role."))
        self.stdout.write("No user or password was created.")
