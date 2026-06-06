FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . .

# Data volume
VOLUME /app/data

EXPOSE 5088

ENV PORT=5088 HOST=0.0.0.0

CMD ["python", "app.py"]
