FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY samples/data/seed.sql /data/seed.sql
COPY samples/backends/dotnet/ ./
RUN sed -i 's#../../data/seed.sql#/data/seed.sql#' WeReport.Backend.csproj \
 && dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
USER app
ENV WE_REPORT_HOST=0.0.0.0
EXPOSE 5480
ENTRYPOINT ["dotnet", "WeReport.Backend.dll"]
