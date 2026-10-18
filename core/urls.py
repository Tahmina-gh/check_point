from django.urls import path
from . import views

urlpatterns = [
    path("auth/signup/", views.signup),
    path("auth/login/", views.login_view),
    path("me/", views.me),

    path("classes/", views.classes_view),
    path("classes/join/", views.join_class),

    path("quizzes/", views.quizzes_view),
    path("quizzes/<int:quiz_id>/take/", views.quiz_take),
    path("quizzes/<int:quiz_id>/submit/", views.quiz_submit),
    path("quizzes/<int:quiz_id>/results/", views.quiz_results),

    path("skillmap/", views.skill_map),

    path("pulses/", views.pulse_create),
    path("pulses/active/", views.pulse_active),
    path("pulses/<int:pulse_id>/end/", views.pulse_end),
    path("pulses/<int:pulse_id>/answer/", views.pulse_answer),
]