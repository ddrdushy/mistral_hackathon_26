FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Start uvicorn (init_db creates tables automatically on startup)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
