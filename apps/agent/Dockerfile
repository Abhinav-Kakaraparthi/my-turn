FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

RUN groupadd --system app && \
    useradd --system --gid app --create-home --home-dir /home/app app

COPY requirements.txt ./

RUN python -m pip install --no-cache-dir --upgrade pip && \
    python -m pip install --no-cache-dir -r requirements.txt

COPY agents ./agents
COPY firestore_memory.py ./firestore_memory.py
COPY main.py ./main.py

USER app

EXPOSE 8080

CMD ["python", "main.py"]
