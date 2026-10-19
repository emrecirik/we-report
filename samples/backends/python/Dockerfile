FROM python:3.13-slim
WORKDIR /app/samples/backends/python
COPY samples/data/seed.sql /app/samples/data/seed.sql
COPY samples/backends/python/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt "psycopg[binary]>=3.2"
COPY samples/backends/python/*.py ./
RUN useradd --system app
USER app
ENV WE_REPORT_HOST=0.0.0.0
EXPOSE 5480
CMD ["python", "main.py"]
