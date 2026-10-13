import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

async function apiRequest(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status}).`;
    try {
      const body = await response.json();
      const detail = body.detail || body.error;
      if (typeof detail === "string") {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail.map((item) => item.msg).join(" ");
      }
    } catch {
      // Keep the HTTP status message if the response is not JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

function statusFor(student) {
  if (student.attendance < 65 || student.marks < 40) return "Needs attention";
  if (student.attendance < 75 || student.marks < 60) return "Monitor";
  return "Good";
}

function App() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [file, setFile] = useState(null);
  const [studentForm, setStudentForm] = useState({
    name: "",
    attendance: "",
    marks: "",
    blood_group: "Unknown",
    assignment_submission_date: "",
    assignment_due_date: "",
    participation_score: "",
    consecutive_absences: "0",
  });
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadStudents = useCallback(async () => {
    const data = await apiRequest("/api/students");
    if (!Array.isArray(data)) {
      throw new Error("The backend returned an invalid student list.");
    }
    setStudents(data);
  }, []);

  useEffect(() => {
    loadStudents()
      .catch((loadError) => setError(`Cannot load students: ${loadError.message}`))
      .finally(() => setLoading(false));
  }, [loadStudents]);

  const stats = useMemo(() => {
    const count = students.length;
    const average = (key) =>
      count
        ? Math.round(
            students.reduce((sum, student) => sum + Number(student[key]), 0) /
              count,
          )
        : 0;
    return {
      total: count,
      attendance: average("attendance"),
      marks: average("marks"),
      healthScore: count
        ? (
            students.reduce(
              (sum, student) => sum + Number(student.academic_health_score || 0),
              0,
            ) / count
          ).toFixed(1)
        : "0.0",
      atRisk: students.filter((student) => statusFor(student) === "Needs attention")
        .length,
      absenceAlerts: students.filter((student) => student.consecutive_absences >= 3)
        .length,
    };
  }, [students]);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return students.filter((student) =>
      student.name.toLowerCase().includes(query),
    );
  }, [students, search]);
  const pageCount = Math.max(1, Math.ceil(filteredStudents.length / pageSize));
  const visibleStudents = filteredStudents.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const flaggedStudents = students.filter(
    (student) => statusFor(student) === "Needs attention",
  );

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  async function uploadCsv(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    setSaving(true);
    try {
      const result = await apiRequest("/api/students/upload", {
        method: "POST",
        body: formData,
      });
      await loadStudents();
      setMessage(`Uploaded ${result.count} student records successfully.`);
      setFile(null);
      document.getElementById("csvFile").value = "";
    } catch (uploadError) {
      setError(`Upload failed: ${uploadError.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function resetData() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const result = await apiRequest("/api/reset", { method: "POST" });
      await loadStudents();
      setSearch("");
      setFile(null);
      setMessage(`Sample dataset restored (${result.count} students).`);
      document.getElementById("csvFile").value = "";
    } catch (resetError) {
      setError(`Reset failed: ${resetError.message}`);
    } finally {
      setSaving(false);
    }
  }

  function clearStudentForm() {
    setStudentForm({
      name: "",
      attendance: "",
      marks: "",
      blood_group: "Unknown",
      assignment_submission_date: "",
      assignment_due_date: "",
      participation_score: "",
      consecutive_absences: "0",
    });
    setEditingStudentId(null);
  }

  async function saveStudent(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSaving(true);
    const isEditing = editingStudentId !== null;
    try {
      await apiRequest(
        isEditing ? `/api/students/${editingStudentId}` : "/api/students/record",
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: studentForm.name,
            attendance: Number(studentForm.attendance),
            marks: Number(studentForm.marks),
            blood_group: studentForm.blood_group,
            assignment_submission_date:
              studentForm.assignment_submission_date || null,
            assignment_due_date: studentForm.assignment_due_date || null,
            participation_score: Number(studentForm.participation_score || 0),
            consecutive_absences: Number(studentForm.consecutive_absences || 0),
          }),
        },
      );
      await loadStudents();
      setMessage(
        isEditing
          ? "Student updated successfully."
          : "Student added successfully.",
      );
      setPage(1);
      clearStudentForm();
    } catch (saveError) {
      setError(`Unable to save student: ${saveError.message}`);
    } finally {
      setSaving(false);
    }
  }

  function editStudent(student) {
    setEditingStudentId(student.id);
    setStudentForm({
      name: student.name,
      attendance: String(student.attendance),
      marks: String(student.marks),
      blood_group: student.blood_group || "Unknown",
      assignment_submission_date: student.assignment_submission_date || "",
      assignment_due_date: student.assignment_due_date || "",
      participation_score: String(student.participation_score ?? 0),
      consecutive_absences: String(student.consecutive_absences ?? 0),
    });
    setError("");
    setMessage(`Editing ${student.name}.`);
    document.getElementById("studentName").focus();
  }

  async function removeStudent(student) {
    if (!window.confirm(`Delete ${student.name} from the student list?`)) {
      return;
    }
    setMessage("");
    setError("");
    setSaving(true);
    try {
      await apiRequest(`/api/students/${student.id}`, { method: "DELETE" });
      await loadStudents();
      if (editingStudentId === student.id) clearStudentForm();
      setMessage(`${student.name} was deleted.`);
    } catch (deleteError) {
      setError(`Unable to delete student: ${deleteError.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <h1>Smart Student Success Predictor</h1>
          <p>Academic monitoring and early student support</p>
        </div>
      </header>

      <main className="container">
        <section className="cards" aria-label="Class statistics">
          <StatCard label="Total Students" value={stats.total} />
          <StatCard label="Average Attendance" value={`${stats.attendance}%`} />
          <StatCard label="Average Marks" value={`${stats.marks}%`} />
          <StatCard
            label="Average Academic Health"
            value={`${stats.healthScore}/100`}
          />
          <StatCard label="Need Attention" value={stats.atRisk} />
          <StatCard label="Absence Streak Alerts" value={stats.absenceAlerts} />
        </section>

        <section className="panel">
          <h2>Upload Student Data</h2>
          <p className="muted">
            Uploading replaces all current records. The sample CSV includes
            attendance, marks, blood group, assignment dates, participation,
            and consecutive absences.
          </p>
          <form className="controls" onSubmit={uploadCsv}>
            <input
              id="csvFile"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              aria-label="Choose student CSV file"
            />
            <button type="submit" disabled={saving}>
              {saving ? "Please wait..." : "Analyze CSV"}
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={resetData}
              disabled={saving}
            >
              Reset Demo
            </button>
            <a className="button-link" href={`${API_BASE}/api/dataset`}>
              Download Sample CSV
            </a>
          </form>
          {message && <p className="message success" role="status">{message}</p>}
          {error && <p className="message error" role="alert">{error}</p>}
        </section>

        <section className="panel">
          <h2>{editingStudentId === null ? "Add Student" : "Edit Student"}</h2>
          <form className="student-form" onSubmit={saveStudent}>
            <label>
              Student name
              <input
                id="studentName"
                type="text"
                maxLength="120"
                required
                value={studentForm.name}
                onChange={(event) =>
                  setStudentForm({ ...studentForm, name: event.target.value })
                }
                placeholder="Enter student name"
              />
            </label>
            <label>
              Attendance (%)
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                required
                value={studentForm.attendance}
                onChange={(event) =>
                  setStudentForm({ ...studentForm, attendance: event.target.value })
                }
                placeholder="0-100"
              />
            </label>
            <label>
              Marks (%)
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                required
                value={studentForm.marks}
                onChange={(event) =>
                  setStudentForm({ ...studentForm, marks: event.target.value })
                }
                placeholder="0-100"
              />
            </label>
            <label>
              Blood group
              <select
                value={studentForm.blood_group}
                onChange={(event) =>
                  setStudentForm({ ...studentForm, blood_group: event.target.value })
                }
              >
                {["Unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
                  (group) => <option key={group} value={group}>{group}</option>,
                )}
              </select>
            </label>
            <label>
              Assignment due date
              <input
                type="date"
                value={studentForm.assignment_due_date}
                onChange={(event) =>
                  setStudentForm({
                    ...studentForm,
                    assignment_due_date: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Assignment submission date
              <input
                type="date"
                value={studentForm.assignment_submission_date}
                onChange={(event) =>
                  setStudentForm({
                    ...studentForm,
                    assignment_submission_date: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Participation score (0–100)
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={studentForm.participation_score}
                onChange={(event) =>
                  setStudentForm({
                    ...studentForm,
                    participation_score: event.target.value,
                  })
                }
                placeholder="0-100"
              />
            </label>
            <label>
              Consecutive absences
              <input
                type="number"
                min="0"
                max="365"
                step="1"
                value={studentForm.consecutive_absences}
                onChange={(event) =>
                  setStudentForm({
                    ...studentForm,
                    consecutive_absences: event.target.value,
                  })
                }
              />
            </label>
            <p className="form-note">
              Grade is calculated from marks. Blood group is profile information
              only and is never used in academic scoring.
            </p>
            <div className="form-actions">
              <button type="submit" disabled={saving}>
                {saving
                  ? "Please wait..."
                  : editingStudentId === null
                    ? "Add Student"
                    : "Save Changes"}
              </button>
              {editingStudentId !== null && (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={clearStudentForm}
                  disabled={saving}
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="panel">
          <h2>Student Performance</h2>
          <input
            className="search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search student..."
            aria-label="Search students"
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Attendance</th>
                  <th scope="col">Marks</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Blood Group</th>
                  <th scope="col">Assignment Due</th>
                  <th scope="col">Assignment Submitted</th>
                  <th scope="col">Participation</th>
                  <th scope="col">Consecutive Absences</th>
                  <th scope="col">Health Score</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="12">Loading students...</td></tr>
                ) : visibleStudents.length ? (
                  visibleStudents.map((student) => {
                    const status = student.status || statusFor(student);
                    const badgeClass =
                      status === "Good" ? "good" : status === "Monitor" ? "medium" : "risk";
                    return (
                      <tr key={student.id}>
                        <td>{student.name}</td>
                        <td>{student.attendance}%</td>
                        <td>{student.marks}%</td>
                        <td>{student.grade}</td>
                        <td>{student.blood_group}</td>
                        <td>{student.assignment_due_date || "—"}</td>
                        <td>{student.assignment_submission_date || "—"}</td>
                        <td>{student.participation_score}%</td>
                        <td>{student.consecutive_absences}</td>
                        <td>
                          <span
                            className={`health-score ${
                              student.academic_health_score < 60
                                ? "risk"
                                : student.academic_health_score < 75
                                  ? "medium"
                                  : "good"
                            }`}
                          >
                            {student.academic_health_score}/100
                          </span>
                        </td>
                        <td><span className={`status ${badgeClass}`}>{status}</span></td>
                        <td className="row-actions">
                          <button
                            className="small-button"
                            type="button"
                            onClick={() => editStudent(student)}
                            disabled={saving}
                            aria-label={`Edit ${student.name}`}
                          >
                            Edit
                          </button>
                          <button
                            className="small-button button-danger"
                            type="button"
                            onClick={() => removeStudent(student)}
                            disabled={saving}
                            aria-label={`Delete ${student.name}`}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr><td colSpan="12">No students found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              Showing {filteredStudents.length ? (page - 1) * pageSize + 1 : 0}–
              {Math.min(page * pageSize, filteredStudents.length)} of{" "}
              {filteredStudents.length} students
            </span>
            <label>
              Rows per page
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
            >
              Previous
            </button>
            <span>Page {page} of {pageCount}</span>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page >= pageCount}
            >
              Next
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Class Performance Overview</h2>
          <p className="muted">
            Class academic health is the average of each student&apos;s individual
            0–100 health score.
          </p>
          <Progress label="Average attendance" value={stats.attendance} />
          <Progress label="Average marks" value={stats.marks} />
          <Progress
            label="Average academic health score"
            value={Number(stats.healthScore)}
          />
        </section>

        <section className="panel">
          <h2>How the Academic Health Score Is Calculated</h2>
          <p>
            Each student&apos;s score starts with attendance (30%), marks (30%),
            and participation (20%). An assignment submitted by its due date
            contributes 10%; late submission scores 0 for that factor. The
            available weighted factors are normalized to a 0–100 scale.
          </p>
          <p>
            Subtract 5 points for every consecutive absence beyond two, then
            clamp the result between 0 and 100. The class score is the arithmetic
            average of all student scores. Letter grades are derived from marks:
            A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, otherwise F.
          </p>
          <p className="muted">
            Missing either assignment date omits the assignment factor.
            Blood group is profile-only and does not affect academic scoring.
            These are demonstration indicators, not medical assessments or
            guaranteed predictions.
          </p>
        </section>

        <section className="panel">
          <h2>Early Warning Alerts</h2>
          {flaggedStudents.length ? (
            <>
              <p className="muted">
                {flaggedStudents.length} student(s) meet the attendance or marks
                warning rules. Showing up to 10.
              </p>
              {flaggedStudents.slice(0, 10).map((student) => {
                const warnings = [];
                if (student.attendance < 65) warnings.push("Low attendance");
                if (student.marks < 40) warnings.push("Low marks");
                if (student.consecutive_absences >= 3) {
                  warnings.push(`${student.consecutive_absences} consecutive absences`);
                }
                return (
                  <div className="alert" key={student.id}>
                    <strong>{student.name}:</strong> {warnings.join(". ")}.
                    {" "}Teacher review recommended.
                  </div>
                );
              })}
            </>
          ) : (
            <p className="muted">No students currently meet the warning rules.</p>
          )}
        </section>
      </main>

      <footer>
        Smart Student Success Predictor | Synthetic demonstration records;
        blood group is not used for scoring.
      </footer>
    </>
  );
}

function StatCard({ label, value }) {
  return (
    <article className="card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function Progress({ label, value }) {
  return (
    <div className="progress-item">
      <div className="progress-label">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div
        className="bar"
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div className="fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
