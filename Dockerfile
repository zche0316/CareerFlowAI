FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN DATABASE_URL=postgresql://build:build@localhost/build npm ci
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost/build npm run db:generate && npm run build
EXPOSE 8787
ENV HOST=0.0.0.0
CMD ["sh", "-c", "npm run db:migrate && npm start"]
