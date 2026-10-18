import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from rest_framework.authtoken.models import Token

from .models import ClassRoom, Enrollment


class ClassPulseConsumer(AsyncWebsocketConsumer):
    """
    One live connection per class. Broadcasts pulse_started / pulse_update /
    pulse_ended events to everyone connected - teacher and students alike.
    Auth works by passing the token in the URL, e.g. ws://host/ws/class/3/?token=abc123
    """

    async def connect(self):
        self.classroom_id = self.scope["url_route"]["kwargs"]["classroom_id"]
        self.group_name = f"class_{self.classroom_id}"

        token_key = None
        query_string = self.scope.get("query_string", b"").decode()
        for pair in query_string.split("&"):
            if pair.startswith("token="):
                token_key = pair.split("=", 1)[1]

        user = await self.get_user_from_token(token_key)
        if user is None or not await self.user_belongs_to_class(user, self.classroom_id):
            await self.close()
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def pulse_started(self, event):
        await self.send(text_data=json.dumps({"type": "pulse_started", "data": event["data"]}))

    async def pulse_update(self, event):
        await self.send(text_data=json.dumps({"type": "pulse_update", "data": event["data"]}))

    async def pulse_ended(self, event):
        await self.send(text_data=json.dumps({"type": "pulse_ended", "data": event["data"]}))

    @database_sync_to_async
    def get_user_from_token(self, token_key):
        if not token_key:
            return None
        try:
            return Token.objects.get(key=token_key).user
        except Token.DoesNotExist:
            return None

    @database_sync_to_async
    def user_belongs_to_class(self, user, classroom_id):
        if ClassRoom.objects.filter(id=classroom_id, teacher=user).exists():
            return True
        return Enrollment.objects.filter(classroom_id=classroom_id, student=user).exists()