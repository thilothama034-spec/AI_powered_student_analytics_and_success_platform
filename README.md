# Smart Student Success Predictor

Student dashboard with a React/Vite frontend, FastAPI backend, and SQLite
database. The synthetic demonstration CSV contains 6,000 student profiles.

## Requirements

- Python 3.10 or newer
- Node.js 20 or newer
- npm

## Install

From the project root, create and activate a Python virtual environment, then
install backend dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Install frontend dependencies:

```powershell
cd frontend
npm install
cd ..
```

## Run locally

Open two PowerShell terminals in the project root.

Terminal 1 — FastAPI and SQLite backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Terminal 2 — React development server:

```powershell
cd frontend
npm run dev
```

Open the frontend at <http://127.0.0.1:5173>. The Vite development server
proxies API requests to FastAPI on port 8000.

## API documentation

- Swagger UI: <http://127.0.0.1:8000/docs>
- ReDoc: <http://127.0.0.1:8000/redoc>
- OpenAPI JSON: <http://127.0.0.1:8000/openapi.json>

## API endpoints

- `GET /api/students` — list students with calculated status
- `POST /api/students` — replace all records with a JSON array of student objects
- `POST /api/students/record` — create one student
- `PUT /api/students/{student_id}` — update one student
- `DELETE /api/students/{student_id}` — delete one student
- `POST /api/students/upload` — replace all records with a CSV multipart upload
- `POST /api/reset` — restore the sample dataset
- `GET /api/dataset` — download the sample CSV

CSV files require `Name`, `Attendance`, and `Marks`; optional columns are
`Blood Group`, `Assignment Due Date`, `Assignment Submission Date`,
`Participation Score`, and `Consecutive Absences`. Attendance, marks, and
participation must be between 0 and 100. CSV uploads are validated before
existing records are replaced. The dashboard paginates the list to keep large
datasets manageable.

The sample data is in `src/main/resources/data/students.csv`. The SQLite database is
`students.db`; it is initialized and seeded with sample data when empty.

## Academic health score

The 0–100 academic health score is a transparent rule-based indicator, not a
medical score or machine-learning prediction:

1. Attendance contributes 30 weighted points.
2. Marks contribute 30 weighted points; the displayed letter grade is derived
   from marks (A: 90+, B: 80–89.9, C: 70–79.9, D: 60–69.9, F: below 60).
3. Participation contributes 20 weighted points.
4. Submitting by the assignment due date contributes 10 weighted points.
   If either assignment date is missing, that factor is omitted and the
   remaining weights are normalized.
5. Subtract 5 points for each consecutive absence beyond two, then clamp the
   result to 0–100.

Formula:

```text
base = (30 × attendance + 30 × marks + 20 × participation
        + 10 × on_time_assignment_score) / available_weight
health_score = clamp(base - 5 × max(0, consecutive_absences - 2), 0, 100)
```

Blood group is synthetic profile data only. It does not affect the score and
should not be collected in a real deployment unless there is a justified,
authorized need and appropriate privacy protections.

## Build frontend

```powershell
cd frontend
npm run build
```

## Deploy on Render

The root-level `render.yaml` deploys the React frontend and FastAPI API together
as one Docker web service. The blueprint includes a persistent disk for SQLite
and requires a paid Render instance; do not change it to an ephemeral free
instance when using real student records.

1. Push this project to the connected GitHub repository.
2. In Render, create a Blueprint from that repository and select the `demo`
   branch (or the branch containing `render.yaml`).
3. Set `APP_USERNAME` and `APP_PASSWORD` as secrets when Render requests them.
   Use a unique, strong password and do not commit either value to GitHub.
4. Deploy the Blueprint. Render supplies the public HTTPS URL; the dashboard
   and API documentation are served from that same URL.

The dashboard and API require HTTP Basic authentication on Render. The
`/api/health` endpoint is intentionally public so Render can monitor the
service. Locally, authentication is disabled unless both `APP_USERNAME` and
`APP_PASSWORD` are set. This is a single shared login, not per-user accounts or
an audit trail; confirm your institution's privacy and access-control
requirements before entering identifiable student data.
