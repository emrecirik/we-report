# Build from the repository root: docker build -f samples/backends/php/Dockerfile .
FROM php:8.3-cli-alpine
RUN apk add --no-cache libpq \
 && apk add --no-cache --virtual .build postgresql-dev \
 && docker-php-ext-install pdo_pgsql \
 && apk del .build
WORKDIR /app
COPY samples/data/seed.sql /app/seed.sql
COPY samples/backends/php/src ./src
COPY samples/backends/php/public ./public
RUN adduser -S -D app
USER app
# The built-in server is fine for a sample; in production put the front controller behind php-fpm.
# Beyond localhost every request needs WE_REPORT_AUTH_TOKEN (or WE_REPORT_DEMO=1).
ENV WE_REPORT_SEED=/app/seed.sql
EXPOSE 5480
CMD ["php", "-S", "0.0.0.0:5480", "public/index.php"]
