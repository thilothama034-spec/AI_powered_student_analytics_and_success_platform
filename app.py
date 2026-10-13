import csv
import io
import os
import sqlite3 
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)


PROJECT_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.getenv("STUDENT_DB_PATH", PROJECT_DIR / "students.db"))
DATASET_PATH = PROJECT_DIR / "src" / "main" / "resources" / "data" / "students.csv"


class StudentInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: Annotated[str, Field(min_length=1, max_length=120)]
    attendance: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
    marks: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
    blood_group: Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"] = "Unknown"
    assignment_submission_date: date | None = None
    assignment_due_date: date | None = None
    participation_score: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] = 0
    consecutive_absences: Annotated[int, Field(ge=0, le=365)] = 0

    @model_validator(mode="before")
    @classmethod
    def reject_boolean_scores(cls, value):
        if isinstance(value, dict) and (
            isinstance(value.get("attendance"), bool)
            or isinstance(value.get("marks"), bool)
            or isinstance(value.get("participation_score"), bool)
            or isinstance(value.get("consecutive_absences"), bool)
        ):
            raise ValueError("Scores and absence counts must be numeric.")
        return value

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value):
        if not value.strip():
            raise ValueError("Student name is required.")
        return value


class Student(StudentInput):
    id: int
    status: str
    grade: str
    academic_health_score: float


class SaveStudentsResponse(BaseModel):
    message: str
    count: int


class DeleteStudentResponse(BaseModel):
    message: str
    id: int


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Smart Student Success Predictor API",
    description=(
        "Student academic monitoring API. Academic health scores combine "
        "attendance, marks, participation, assignment timeliness, and absence streaks."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


def load_dataset() -> list[StudentInput]:
    try:
        with DATASET_PATH.open(encoding="utf-8-sig", newline="") as dataset_file:
            reader = csv.DictReader(dataset_file)
            if not reader.fieldnames:
                raise ValueError("The sample dataset has no header row.")

            headers = {header.strip().lower() for header in reader.fieldnames}
            if not {"name", "attendance", "marks"}.issubset(headers):
                raise ValueError(
                    "The sample dataset must contain Name, Attendance, and Marks columns."
                )

            records = []
            for line_number, row in enumerate(reader, start=2):
                normalized_row = {
                    key.strip().lower(): value for key, value in row.items() if key
                }
                try:
                    records.append(
                        StudentInput(
                            name=normalized_row.get("name") or "",
                            attendance=normalized_row.get("attendance"),
                            marks=normalized_row.get("marks"),
                            blood_group=normalized_row.get("blood group") or "Unknown",
                            assignment_submission_date=(
                                normalized_row.get("assignment submission date") or None
                            ),
                            assignment_due_date=(
                                normalized_row.get("assignment due date") or None
                            ),
                            participation_score=(
                                normalized_row.get("participation score") or 0
                            ),
                            consecutive_absences=(
                                normalized_row.get("consecutive absences") or 0
                            ),
                        )
                    )
                except ValidationError as exc:
                    raise ValueError(
                        f"Invalid sample dataset record on line {line_number}: {exc}"
                    ) from exc
    except OSError as exc:
        raise RuntimeError(f"Cannot read sample dataset at {DATASET_PATH}: {exc}") from exc

    if not records:
        raise ValueError("The sample dataset contains no student records.")
    return records


def init_db() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                attendance REAL NOT NULL CHECK(attendance BETWEEN 0 AND 100),
                marks REAL NOT NULL CHECK(marks BETWEEN 0 AND 100),
                blood_group TEXT NOT NULL DEFAULT 'Unknown',
                assignment_submission_date TEXT,
                assignment_due_date TEXT,
                participation_score REAL NOT NULL DEFAULT 0,
                consecutive_absences INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        existing_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(students)").fetchall()
        }
        migrations = {
            "blood_group": "TEXT NOT NULL DEFAULT 'Unknown'",
            "assignment_submission_date": "TEXT",
            "assignment_due_date": "TEXT",
            "participation_score": "REAL NOT NULL DEFAULT 0",
            "consecutive_absences": "INTEGER NOT NULL DEFAULT 0",
        }
        for column, declaration in migrations.items():
            if column not in existing_columns:
                conn.execute(f"ALTER TABLE students ADD COLUMN {column} {declaration}")
        count = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        if count == 0:
            insert_students(conn, load_dataset())


def insert_students(conn: sqlite3.Connection, students: list[StudentInput]) -> None:
    conn.executemany(
        """
        INSERT INTO students (
            name, attendance, marks, blood_group, assignment_submission_date,
            assignment_due_date, participation_score, consecutive_absences
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                student.name,
                student.attendance,
                student.marks,
                student.blood_group,
                student.assignment_submission_date.isoformat()
                if student.assignment_submission_date
                else None,
                student.assignment_due_date.isoformat()
                if student.assignment_due_date
                else None,
                student.participation_score,
                student.consecutive_absences,
            )
            for student in students
        ],
    )


def get_status(attendance: float, marks: float) -> str:
    if attendance < 65 or marks < 40:
        return "Needs attention"
    if attendance < 75 or marks < 60:
        return "Monitor"
    return "Good"


def get_grade(marks: float) -> str:
    if marks >= 90:
        return "A"
    if marks >= 80:
        return "B"
    if marks >= 70:
        return "C"
    if marks >= 60:
        return "D"
    return "F"


def get_health_score(student: StudentInput) -> float:
    weighted_score = (
        student.attendance * 30
        + student.marks * 30
        + student.participation_score * 20
    )
    available_weight = 80
    if student.assignment_submission_date and student.assignment_due_date:
        assignment_score = (
            100
            if student.assignment_submission_date <= student.assignment_due_date
            else 0
        )
        weighted_score += assignment_score * 10
        available_weight += 10

    absence_penalty = max(0, student.consecutive_absences - 2) * 5
    return round(
        max(0, min(100, weighted_score / available_weight - absence_penalty)), 1
    )


def get_students() -> list[Student]:
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, name, attendance, marks, blood_group,
                   assignment_submission_date, assignment_due_date,
                   participation_score, consecutive_absences
            FROM students ORDER BY id
            """
        ).fetchall()

    students = []
    for row in rows:
        record = dict(row)
        for field in ("assignment_submission_date", "assignment_due_date"):
            record[field] = date.fromisoformat(record[field]) if record[field] else None
        student_input = StudentInput(**record)
        students.append(
            Student(
                **record,
                status=get_status(record["attendance"], record["marks"]),
                grade=get_grade(record["marks"]),
                academic_health_score=get_health_score(student_input),
            )
        )
    return students


def replace_students(students: list[StudentInput]) -> None:
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute("DELETE FROM students")
        insert_students(conn, students)


def parse_csv(contents: str) -> list[StudentInput]:
    reader = csv.DictReader(io.StringIO(contents, newline=""))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV is missing its header row.")

    headers = {header.strip().lower() for header in reader.fieldnames}
    if not {"name", "attendance", "marks"}.issubset(headers):
        raise HTTPException(
            status_code=400,
            detail="CSV must contain Name, Attendance, and Marks columns.",
        )

    students = []
    for line_number, row in enumerate(reader, start=2):
        if None in row:
            raise HTTPException(
                status_code=400,
                detail=f"CSV row {line_number} contains too many columns.",
            )
        normalized_row = {
            key.strip().lower(): value for key, value in row.items() if key
        }
        try:
            student = StudentInput(
                name=normalized_row.get("name") or "",
                attendance=normalized_row.get("attendance"),
                marks=normalized_row.get("marks"),
                blood_group=normalized_row.get("blood group") or "Unknown",
                assignment_submission_date=(
                    normalized_row.get("assignment submission date") or None
                ),
                assignment_due_date=normalized_row.get("assignment due date") or None,
                participation_score=normalized_row.get("participation score") or 0,
                consecutive_absences=normalized_row.get("consecutive absences") or 0,
            )
        except ValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid CSV row {line_number}: {exc}",
            ) from exc
        students.append(student)

    if not students:
        raise HTTPException(status_code=400, detail="CSV has no student records.")
    return students


def student_response(student_id: int, student: StudentInput) -> Student:
    return Student(
        id=student_id,
        **student.model_dump(),
        status=get_status(student.attendance, student.marks),
        grade=get_grade(student.marks),
        academic_health_score=get_health_score(student),
    )


def student_db_values(student: StudentInput) -> tuple:
    return (
        student.name,
        student.attendance,
        student.marks,
        student.blood_group,
        student.assignment_submission_date.isoformat()
        if student.assignment_submission_date
        else None,
        student.assignment_due_date.isoformat() if student.assignment_due_date else None,
        student.participation_score,
        student.consecutive_absences,
    )


@app.get("/api/students", response_model=list[Student], tags=["Students"])
def list_students():
    return get_students()


@app.post("/api/students", response_model=SaveStudentsResponse, tags=["Students"])
def save_students(
    students: Annotated[list[StudentInput], Body(min_length=1)],
):
    replace_students(students)
    return {"message": "Student records saved successfully.", "count": len(students)}


@app.post("/api/students/record", response_model=Student, status_code=201, tags=["Students"])
def create_student(student: StudentInput):
    with sqlite3.connect(DATABASE_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO students (
                name, attendance, marks, blood_group, assignment_submission_date,
                assignment_due_date, participation_score, consecutive_absences
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            student_db_values(student),
        )
        student_id = cursor.lastrowid

    return student_response(student_id, student)


@app.put("/api/students/{student_id}", response_model=Student, tags=["Students"])
def update_student(student_id: int, student: StudentInput):
    with sqlite3.connect(DATABASE_PATH) as conn:
        cursor = conn.execute(
            """
            UPDATE students
            SET name = ?, attendance = ?, marks = ?, blood_group = ?,
                assignment_submission_date = ?, assignment_due_date = ?,
                participation_score = ?, consecutive_absences = ?
            WHERE id = ?
            """,
            (*student_db_values(student), student_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Student was not found.")

    return student_response(student_id, student)


@app.delete(
    "/api/students/{student_id}",
    response_model=DeleteStudentResponse,
    tags=["Students"],
)
def delete_student(student_id: int):
    with sqlite3.connect(DATABASE_PATH) as conn:
        cursor = conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Student was not found.")
    return {"message": "Student deleted successfully.", "id": student_id}


@app.post("/api/students/upload", response_model=SaveStudentsResponse, tags=["Students"])
async def upload_students_csv(file: Annotated[UploadFile, File()]):
    if not file.filename or Path(file.filename).suffix.lower() != ".csv":
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")

    contents = await file.read(5_000_001)
    if len(contents) > 5_000_000:
        raise HTTPException(status_code=413, detail="CSV file must be 5 MB or smaller.")
    try:
        text = contents.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=400, detail="CSV must use UTF-8 text encoding."
        ) from exc

    students = parse_csv(text)
    replace_students(students)
    return {"message": "Student records saved successfully.", "count": len(students)}


@app.post("/api/reset", response_model=SaveStudentsResponse, tags=["Students"])
def reset_students():
    students = load_dataset()
    replace_students(students)
    return {"message": "Sample dataset restored.", "count": len(students)}


@app.get("/api/dataset", response_class=FileResponse, tags=["Dataset"])
def download_dataset():
    if not DATASET_PATH.is_file():
        raise HTTPException(status_code=404, detail="Sample dataset was not found.")
    return FileResponse(
        DATASET_PATH,
        media_type="text/csv",
        filename="students.csv",
    )
