import { defineRailway, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "sfo" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "sfo",
    sizeMB: 5000,
  });
  const growthos = service("growthos", {
    build: "npm run build",
    start: "npm start",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { sfo: 1 },
    env: {
      APP_URL: preserve(),
      DATABASE_URL: preserve(),
      ENCRYPTION_KEY: preserve(),
      SESSION_SECRET: preserve(),
      CIRCLE_API_KEY: preserve(),
      CIRCLE_ENTITY_SECRET: preserve(),
    },
  });
  return project("growthos", {
    resources: [Postgres, growthos, postgresVolume],
  });
});
