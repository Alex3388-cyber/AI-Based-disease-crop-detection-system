# AI-Based Crop Disease Detection System

A Progressive Web Application for detecting crop diseases from uploaded leaf images. The project uses a React frontend, Node.js/Express API, PostgreSQL database, Flask AI service, OpenCV preprocessing, TensorFlow/Keras, and Django Admin.

## Project status

The application structure is complete, but a trained model is **not included** in this repository yet. Until `best_model.keras` and its matching model files are added, the AI service will correctly return `MODEL_NOT_READY` instead of a fake prediction.

## Main technologies

- React + Vite + TypeScript
- Node.js + Express + TypeScript
- PostgreSQL
- Python + Flask + OpenCV
- TensorFlow / Keras
- Django Admin
- Docker Compose (optional)

## Project structure

```text
frontend/       React PWA
backend/        Node.js/Express API
ai-service/     Flask inference service
admin/          Django administration
ml/             Dataset, training and evaluation scripts
database/       PostgreSQL schema and migrations
docs/           Architecture, API and deployment notes
```

## Requirements

For normal local development:

- Node.js 20.11 or newer
- npm
- Python 3.11 or newer
- PostgreSQL

Docker Desktop can also be used to run the complete stack.

## 1. Clone the repository

```bash
git clone <repository-url>
cd Nokia-Project
```

## 2. Install JavaScript dependencies

From the project root:

```bash
npm run install:all
```

Or install them separately:

```bash
cd backend
npm install

cd ../frontend
npm install
```

## 3. Configure environment variables

Copy the example environment files and replace the `CHANGE_ME` values with your own development secrets.

Root Docker setup:

```powershell
Copy-Item .env.example .env
```

Backend:

```powershell
Copy-Item backend/.env.example backend/.env
```

AI service:

```powershell
Copy-Item ai-service/.env.example ai-service/.env
```

Do not commit `.env` files or real passwords to GitHub.

## 4. Run with Docker

If Docker Desktop is installed:

```bash
docker compose up --build
```

Open:

- Application: `http://localhost:8080`
- Django Admin: `http://localhost:8000/admin/`
- API health: `http://localhost:8080/api/health`

Stop the containers with:

```bash
docker compose down
```

## 5. Run manually

### PostgreSQL

Create a PostgreSQL database named `crop_disease` and configure the database credentials in `backend/.env` and the Django environment.

Apply the schema from the `database` folder. See `database/README.md` for the database-role setup.

### AI service

Open a new terminal:

```powershell
cd ai-service
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
$env:AI_SERVICE_SECRET="use-the-same-secret-as-the-backend"
flask --app wsgi run --host 127.0.0.1 --port 5000
```

### Node.js backend

Open another terminal:

```powershell
cd backend
npm install
npm run dev
```

The API runs on `http://localhost:3000`.

### React frontend

Open another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### Django Admin

Open another terminal and set the required development variables before starting Django:

```powershell
cd admin
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt

$env:DJANGO_SECRET_KEY="replace-with-a-long-development-secret-key"
$env:DJANGO_DEBUG="true"
$env:DATABASE_HOST="127.0.0.1"
$env:DATABASE_PORT="5432"
$env:DATABASE_NAME="crop_disease"
$env:DATABASE_USER="crop_admin"
$env:DATABASE_PASSWORD="your-admin-database-password"

python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 8000
```

Open `http://localhost:8000/admin/`.

## AI model files

When the trained model is ready, the inference bundle belongs in:

```text
ai-service/model/
```

The model directory is expected to contain the exported model and matching metadata/class files produced by the training pipeline. Do not manually guess the class order.

## Tests

JavaScript tests:

```bash
npm test
```

Backend only:

```bash
cd backend
npm test
npm run typecheck
npm run lint
```

Frontend only:

```bash
cd frontend
npm test
npm run typecheck
npm run lint
```

AI service:

```bash
cd ai-service
pytest -q
```

## Important notes

- Only JPG, PNG and WEBP images are accepted.
- Maximum upload size is 8 MB.
- Uploaded images are validated before inference.
- The browser communicates with the Node.js API, not directly with Flask.
- Secrets and passwords must stay in environment variables.
- Real disease treatment information should be reviewed before it is marked as validated.

For more details, see `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`, and `SECURITY.md`.
