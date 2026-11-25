FROM node:22-alpine
WORKDIR /app
COPY . .
RUN node build.js
ENV PORT=8080 MARSA_DB=/app/data/marsa.db MARSA_DEMO=1
EXPOSE 8080
CMD ["node", "server/server.js"]
