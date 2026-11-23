FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY ai_service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --system agent
COPY ai_service ./ai_service
USER agent
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "ai_service.app:app", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]
