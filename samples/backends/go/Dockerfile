# Build from the repository root: docker build -f samples/backends/go/Dockerfile .
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY samples/backends/go/go.mod samples/backends/go/go.sum ./
RUN go mod download
COPY samples/backends/go/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /we-report-backend .

FROM alpine:3.22
RUN adduser -S -D app
COPY --from=build /we-report-backend /usr/local/bin/we-report-backend
COPY samples/data/seed.sql /app/seed.sql
WORKDIR /app
USER app
# Listening beyond localhost needs WE_REPORT_AUTH_TOKEN (or WE_REPORT_DEMO=1).
ENV WE_REPORT_HOST=0.0.0.0 WE_REPORT_SEED=/app/seed.sql
EXPOSE 5480
CMD ["we-report-backend"]
