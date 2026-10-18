from django.contrib import admin
from .models import Profile, ClassRoom, Enrollment, Quiz, Question, Response, Pulse, PulseResponse

admin.site.register(Profile)
admin.site.register(ClassRoom)
admin.site.register(Enrollment)
admin.site.register(Quiz)
admin.site.register(Question)
admin.site.register(Response)
admin.site.register(Pulse)
admin.site.register(PulseResponse)