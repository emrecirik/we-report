FROM eclipse-temurin:21-jdk AS build
WORKDIR /src/samples/backends/spring-boot
COPY samples/data/seed.sql /src/samples/data/seed.sql
COPY samples/backends/spring-boot/ ./
RUN ./mvnw -q -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/samples/backends/spring-boot/target/we-report-backend-0.1.0.jar app.jar
RUN useradd --system app
USER app
ENV WE_REPORT_HOST=0.0.0.0
EXPOSE 5480
ENTRYPOINT ["java", "-jar", "app.jar"]
