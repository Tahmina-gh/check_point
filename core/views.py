from datetime import timedelta

from django.contrib.auth.models import User
from django.db import IntegrityError
from django.contrib.auth import authenticate
from django.utils import timezone

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response as DRFResponse
from rest_framework.authtoken.models import Token

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Profile, ClassRoom, Enrollment, Quiz, Question, Response, Pulse, PulseResponse


def broadcast(classroom_id, event_type, payload):
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"class_{classroom_id}",
        {"type": event_type, "data": payload},
    )


def user_can_access_classroom(user, classroom_id):
    """True if the user teaches this classroom, or is enrolled in it as a student."""
    if user.profile.role == "teacher":
        return ClassRoom.objects.filter(id=classroom_id, teacher=user).exists()
    return Enrollment.objects.filter(classroom_id=classroom_id, student=user).exists()


# ============================================================
# AUTH
# ============================================================
@api_view(["POST"])
@permission_classes([AllowAny])
def signup(request):
    name = request.data.get("name", "").strip()
    email = request.data.get("email", "").strip().lower()
    password = request.data.get("password", "")
    role = request.data.get("role", "student")

    if not name or not email or not password:
        return DRFResponse({"detail": "Name, email, and password are all required."}, status=400)
    if role not in ("teacher", "student"):
        return DRFResponse({"detail": "Role must be 'teacher' or 'student'."}, status=400)
    if User.objects.filter(username=email).exists():
        return DRFResponse({"detail": "That email already has an account."}, status=400)

    user = User.objects.create_user(username=email, email=email, password=password, first_name=name)
    Profile.objects.create(user=user, role=role)
    token, _ = Token.objects.get_or_create(user=user)

    return DRFResponse({"token": token.key, "name": name, "role": role})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    email = request.data.get("email", "").strip().lower()
    password = request.data.get("password", "")

    user = authenticate(username=email, password=password)
    if user is None:
        return DRFResponse({"detail": "Email or password didn't match."}, status=400)

    token, _ = Token.objects.get_or_create(user=user)
    return DRFResponse({"token": token.key, "name": user.first_name, "role": user.profile.role})


@api_view(["GET"])
def me(request):
    return DRFResponse({
        "name": request.user.first_name,
        "email": request.user.email,
        "role": request.user.profile.role,
    })


# ============================================================
# CLASSES
# ============================================================
@api_view(["GET", "POST"])
def classes_view(request):
    if request.method == "POST":
        if request.user.profile.role != "teacher":
            return DRFResponse({"detail": "Only teachers can create classes."}, status=403)

        name = request.data.get("name", "").strip()
        if not name:
            return DRFResponse({"detail": "Give the class a name."}, status=400)

        # ClassRoom.code is randomly generated and unique; retry a few times in the
        # rare case two classes generate the same 6-character code.
        classroom = None
        for _ in range(5):
            try:
                classroom = ClassRoom.objects.create(name=name, teacher=request.user)
                break
            except IntegrityError:
                continue
        if classroom is None:
            return DRFResponse({"detail": "Could not generate a unique class code. Please try again."}, status=500)

        return DRFResponse({"id": classroom.id, "name": classroom.name, "code": classroom.code}, status=201)

    # GET - list classes for the logged-in user
    if request.user.profile.role == "teacher":
        classrooms = ClassRoom.objects.filter(teacher=request.user).order_by("-created_at")
    else:
        enrollments = Enrollment.objects.filter(student=request.user)
        classroom_ids = enrollments.values_list("classroom_id", flat=True)
        classrooms = ClassRoom.objects.filter(id__in=classroom_ids).order_by("-created_at")

    result = []
    for c in classrooms:
        result.append({"id": c.id, "name": c.name, "code": c.code})

    return DRFResponse(result)

@api_view(["POST"])
def join_class(request):
    if request.user.profile.role != "student":
        return DRFResponse({"detail": "Only students can join classes."}, status=403)

    code = request.data.get("code", "").strip().upper()
    try:
        classroom = ClassRoom.objects.get(code=code)
    except ClassRoom.DoesNotExist:
        return DRFResponse({"detail": "No class found with that code."}, status=404)

    Enrollment.objects.get_or_create(classroom=classroom, student=request.user)
    return DRFResponse({"id": classroom.id, "name": classroom.name})


# ============================================================
# QUIZZES
# ============================================================
@api_view(["GET", "POST"])
def quizzes_view(request):
    if request.method == "POST":
        if request.user.profile.role != "teacher":
            return DRFResponse({"detail": "Only teachers can create quizzes."}, status=403)

        classroom_id = request.data.get("classroom_id")
        title = request.data.get("title", "").strip()
        open_minutes = int(request.data.get("open_minutes", 60))
        questions_data = request.data.get("questions", [])

        if not title:
            return DRFResponse({"detail": "Give the quiz a title."}, status=400)
        if not questions_data:
            return DRFResponse({"detail": "Add at least one question."}, status=400)

        try:
            classroom = ClassRoom.objects.get(id=classroom_id, teacher=request.user)
        except ClassRoom.DoesNotExist:
            return DRFResponse({"detail": "Class not found."}, status=404)

        quiz = Quiz.objects.create(
            classroom=classroom,
            teacher=request.user,
            title=title,
            open_until=timezone.now() + timedelta(minutes=open_minutes),
        )
        for i, q in enumerate(questions_data):
            Question.objects.create(
                quiz=quiz, text=q["text"], topic=q.get("topic", "General"),
                options=q["options"], correct_index=q["correct_index"], order=i,
            )
        return DRFResponse({"id": quiz.id, "title": quiz.title}, status=201)

    # GET - list quizzes for a class
    classroom_id = request.query_params.get("classroom_id")
    if not classroom_id:
        return DRFResponse({"detail": "classroom_id is required."}, status=400)
    if not user_can_access_classroom(request.user, classroom_id):
        return DRFResponse({"detail": "You don't have access to this class."}, status=403)

    quizzes = Quiz.objects.filter(classroom_id=classroom_id).order_by("-created_at")
    result = []
    for quiz in quizzes:
        item = {
            "id": quiz.id, "title": quiz.title,
            "is_open": quiz.is_open, "question_count": quiz.questions.count(),
        }
        if request.user.profile.role == "student":
            resp = Response.objects.filter(quiz=quiz, student=request.user).first()
            item["taken"] = resp is not None
            item["score"] = resp.score if resp else None
        result.append(item)

    return DRFResponse(result)


@api_view(["GET"])
def quiz_take(request, quiz_id):
    try:
        quiz = Quiz.objects.get(id=quiz_id)
    except Quiz.DoesNotExist:
        return DRFResponse({"detail": "Quiz not found."}, status=404)

    if not user_can_access_classroom(request.user, quiz.classroom_id):
        return DRFResponse({"detail": "You don't have access to this quiz."}, status=403)

    questions = []
    for q in quiz.questions.all():
        questions.append({"id": q.id, "text": q.text, "topic": q.topic, "options": q.options})

    return DRFResponse({"id": quiz.id, "title": quiz.title, "is_open": quiz.is_open, "questions": questions})


@api_view(["POST"])
def quiz_submit(request, quiz_id):
    if request.user.profile.role != "student":
        return DRFResponse({"detail": "Only students can submit quizzes."}, status=403)
    try:
        quiz = Quiz.objects.get(id=quiz_id)
    except Quiz.DoesNotExist:
        return DRFResponse({"detail": "Quiz not found."}, status=404)

    if not Enrollment.objects.filter(classroom_id=quiz.classroom_id, student=request.user).exists():
        return DRFResponse({"detail": "You don't have access to this quiz."}, status=403)

    # Server is authoritative about attempt eligibility - never trust the client for this.
    if Response.objects.filter(quiz=quiz, student=request.user).exists():
        return DRFResponse({"detail": "You've already submitted this quiz. Only one attempt is allowed."}, status=400)
    if not quiz.is_open:
        return DRFResponse({"detail": "This quiz is closed."}, status=400)

    submitted_answers = request.data.get("answers", [])
    questions_by_id = {q.id: q for q in quiz.questions.all()}

    result_answers = []
    correct_count = 0
    for a in submitted_answers:
        q = questions_by_id.get(a.get("question_id"))
        if not q:
            continue
        selected = a.get("selected_index")
        is_correct = selected == q.correct_index
        if is_correct:
            correct_count += 1
        result_answers.append({
            "question_id": q.id, "topic": q.topic,
            "selected_index": selected, "correct_index": q.correct_index, "correct": is_correct,
        })

    total = len(result_answers) or 1
    score = round(100 * correct_count / total)

    try:
        Response.objects.create(quiz=quiz, student=request.user, answers=result_answers, score=score)
    except IntegrityError:
        # Race: two submissions landed at once (e.g. double-click, two tabs). Only the first counts.
        return DRFResponse({"detail": "You've already submitted this quiz. Only one attempt is allowed."}, status=400)

    return DRFResponse({"score": score, "answers": result_answers, "saved": True})


@api_view(["GET"])
def quiz_results(request, quiz_id):
    try:
        quiz = Quiz.objects.get(id=quiz_id, teacher=request.user)
    except Quiz.DoesNotExist:
        return DRFResponse({"detail": "Quiz not found."}, status=404)

    responses = list(Response.objects.filter(quiz=quiz))
    per_question = []
    for q in quiz.questions.all():
        total = correct = 0
        for r in responses:
            match = next((a for a in r.answers if a["question_id"] == q.id), None)
            if match:
                total += 1
                if match["correct"]:
                    correct += 1
        per_question.append({
            "text": q.text, "topic": q.topic,
            "pct": round(100 * correct / total) if total else 0, "total": total,
        })

    avg_score = round(sum(r.score for r in responses) / len(responses)) if responses else 0
    return DRFResponse({
        "title": quiz.title, "response_count": len(responses),
        "avg_score": avg_score, "per_question": per_question,
    })


# ============================================================
# SKILL MAP
# ============================================================
@api_view(["GET"])
def skill_map(request):
    if request.user.profile.role != "student":
        return DRFResponse({"detail": "Only students have a skill map."}, status=403)

    classroom_id = request.query_params.get("classroom_id")
    if not classroom_id:
        return DRFResponse({"detail": "classroom_id is required."}, status=400)
    if not Enrollment.objects.filter(classroom_id=classroom_id, student=request.user).exists():
        return DRFResponse({"detail": "You are not enrolled in this class."}, status=403)

    responses = Response.objects.filter(student=request.user, quiz__classroom_id=classroom_id)
    topic_stats = {}
    for r in responses:
        for a in r.answers:
            topic = a.get("topic", "General")
            stats = topic_stats.setdefault(topic, {"correct": 0, "total": 0})
            stats["total"] += 1
            if a.get("correct"):
                stats["correct"] += 1

    result = [
        {"topic": t, "correct": s["correct"], "total": s["total"], "pct": round(100 * s["correct"] / s["total"])}
        for t, s in topic_stats.items()
    ]
    return DRFResponse(result)


# ============================================================
# LIVE PULSE
# ============================================================
@api_view(["POST"])
def pulse_create(request):
    if request.user.profile.role != "teacher":
        return DRFResponse({"detail": "Only teachers can start a pulse."}, status=403)

    classroom_id = request.data.get("classroom_id")
    question = request.data.get("question", "").strip()
    options = request.data.get("options", [])
    correct_index = request.data.get("correct_index")

    try:
        classroom = ClassRoom.objects.get(id=classroom_id, teacher=request.user)
    except ClassRoom.DoesNotExist:
        return DRFResponse({"detail": "Class not found."}, status=404)
    if not question or len(options) != 4 or correct_index not in (0, 1, 2, 3):
        return DRFResponse({"detail": "Question and exactly 4 options are required."}, status=400)

    Pulse.objects.filter(classroom=classroom, active=True).update(active=False)

    pulse = Pulse.objects.create(
        classroom=classroom, teacher=request.user, question=question,
        options=options, correct_index=correct_index, active=True,
    )
    payload = {"id": pulse.id, "question": pulse.question, "options": pulse.options}
    broadcast(classroom.id, "pulse_started", payload)
    return DRFResponse(payload, status=201)


@api_view(["POST"])
def pulse_end(request, pulse_id):
    try:
        pulse = Pulse.objects.get(id=pulse_id, teacher=request.user)
    except Pulse.DoesNotExist:
        return DRFResponse({"detail": "Pulse not found."}, status=404)

    pulse.active = False
    pulse.save()
    broadcast(pulse.classroom_id, "pulse_ended", {"id": pulse.id})
    return DRFResponse({"ok": True})


@api_view(["GET"])
def pulse_active(request):
    classroom_id = request.query_params.get("classroom_id")
    if not classroom_id:
        return DRFResponse({"detail": "classroom_id is required."}, status=400)
    if not user_can_access_classroom(request.user, classroom_id):
        return DRFResponse({"detail": "You don't have access to this class."}, status=403)

    pulse = Pulse.objects.filter(classroom_id=classroom_id, active=True).order_by("-created_at").first()
    if not pulse:
        return DRFResponse(None)
    return DRFResponse({"id": pulse.id, "question": pulse.question, "options": pulse.options})


@api_view(["POST"])
def pulse_answer(request, pulse_id):
    if request.user.profile.role != "student":
        return DRFResponse({"detail": "Only students can answer a pulse."}, status=403)
    try:
        pulse = Pulse.objects.get(id=pulse_id, active=True)
    except Pulse.DoesNotExist:
        return DRFResponse({"detail": "This question isn't live anymore."}, status=404)

    if not Enrollment.objects.filter(classroom_id=pulse.classroom_id, student=request.user).exists():
        return DRFResponse({"detail": "You don't have access to this class."}, status=403)

    selected = request.data.get("selected_index")
    is_correct = selected == pulse.correct_index

    _, created = PulseResponse.objects.get_or_create(
        pulse=pulse, student=request.user,
        defaults={"selected_index": selected, "correct": is_correct},
    )
    if not created:
        return DRFResponse({"detail": "You already answered this one."}, status=400)

    counts = [0, 0, 0, 0]
    for pr in pulse.responses.all():
        counts[pr.selected_index] += 1
    broadcast(pulse.classroom_id, "pulse_update", {"pulse_id": pulse.id, "counts": counts})

    return DRFResponse({"correct": is_correct})