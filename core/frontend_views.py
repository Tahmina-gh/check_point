from pathlib import Path
from django.conf import settings
from django.http import HttpResponse, Http404


def serve_page(request, filename="index.html"):
    path = Path(settings.BASE_DIR) / "frontend" / filename
    if not path.exists():
        raise Http404()
    return HttpResponse(path.read_text(encoding="utf-8"), content_type="text/html")